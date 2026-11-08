//! Encrypted copies of the database in the cloud.
//!
//! The live database stays local. Settings here live beside it rather than inside
//! it, so restoring a backup cannot change them.

mod crypto;
mod drive;
mod oauth;
pub(crate) mod secrets;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::oneshot;

use crate::data::AppError;
use crate::db::Database;
use drive::{BACKUP_SUFFIX, BackupStore, DriveStore};
pub use drive::RemoteBackup;
use oauth::{GoogleApi, OAuthClient};
use secrets::Secret;

const DEFAULT_RETENTION: usize = 10;
const RETENTION_CHOICES: [usize; 4] = [5, 10, 20, 30];
const MIN_PASSPHRASE_CHARS: usize = 8;
const CLOSING_EVENT: &str = "backup-closing";
/// How long a closing app may wait for its backup before quitting anyway.
const CLOSE_LIMIT: Duration = Duration::from_secs(90);
const CREDENTIALS_LIMIT: Duration = Duration::from_secs(15);

type Result<T> = std::result::Result<T, AppError>;

#[derive(Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct BackupSettings {
    retention: usize,
    account: Option<String>,
    last_backup_at: Option<String>,
    last_error: Option<String>,
    /// Hash of the last uploaded database, to skip uploading the same data on close.
    last_hash: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            retention: DEFAULT_RETENTION,
            account: None,
            last_backup_at: None,
            last_error: None,
            last_hash: None,
        }
    }
}

pub struct BackupService {
    settings_path: PathBuf,
    settings: Mutex<BackupSettings>,
    /// One backup or restore at a time.
    operation: tokio::sync::Mutex<()>,
    closing: AtomicBool,
    cancel_sign_in: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    configured: bool,
    connected: bool,
    account: Option<String>,
    has_passphrase: bool,
    retention: usize,
    last_backup_at: Option<String>,
    last_error: Option<String>,
    local_empty: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Trigger {
    Manual,
    Close,
}

impl BackupService {
    pub fn new(data_dir: &Path) -> Self {
        let settings_path = data_dir.join("backup-settings.json");
        let settings = fs::read(&settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            settings_path,
            settings: Mutex::new(settings),
            operation: tokio::sync::Mutex::new(()),
            closing: AtomicBool::new(false),
            cancel_sign_in: Mutex::new(None),
        }
    }

    /// True the first time only, so a second close skips the wait and quits.
    pub fn begin_closing(&self) -> bool {
        !self.closing.swap(true, Ordering::SeqCst)
    }

    fn read<T>(&self, read: impl FnOnce(&BackupSettings) -> T) -> Result<T> {
        let settings = self.settings.lock().map_err(|e| AppError::from_message(e.to_string()))?;
        Ok(read(&settings))
    }

    fn update(&self, change: impl FnOnce(&mut BackupSettings)) -> Result<()> {
        let mut settings = self.settings.lock().map_err(|e| AppError::from_message(e.to_string()))?;
        change(&mut settings);
        let text = serde_json::to_vec_pretty(&*settings)
            .map_err(|e| AppError::from_message(e.to_string()))?;
        let temporary = self.settings_path.with_extension("json.tmp");
        fs::write(&temporary, text)
            .and_then(|()| fs::rename(&temporary, &self.settings_path))
            .map_err(|e| AppError::from_message(e.to_string()))
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| AppError::from_message(e.to_string()))?
}

/// Runs work that talks to the credential store, which on Linux can hang when the
/// store is broken or waiting to be unlocked.
pub(crate) async fn credentials<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::time::timeout(CREDENTIALS_LIMIT, blocking(work))
        .await
        .map_err(|_| AppError::code("credentials_unavailable"))?
}

fn oauth_client() -> Result<OAuthClient> {
    OAuthClient::load().ok_or_else(|| AppError::code("drive_not_configured"))
}

async fn open_store() -> Result<DriveStore> {
    let client = oauth_client()?;
    let refresh = credentials(|| Secret::RefreshToken.get())
        .await?
        .ok_or_else(|| AppError::code("drive_not_connected"))?;
    let api = GoogleApi::current();
    let token = oauth::access_token(&api, &client, &refresh).await?;
    DriveStore::with_access_token(api, token).await
}

/// Deletes all but the newest `keep` backups.
async fn prune<S: BackupStore>(store: &S, keep: usize) -> Result<()> {
    let mut backups = store.list().await?;
    backups.sort_by(|a, b| b.created_time.cmp(&a.created_time));
    for old in backups.iter().skip(keep) {
        store.delete(&old.id).await?;
    }
    Ok(())
}

/// Upload first and prune after, so a failure never costs an existing copy.
async fn upload_and_prune<S: BackupStore>(
    store: &S,
    name: &str,
    file: Vec<u8>,
    keep: usize,
) -> Result<RemoteBackup> {
    let uploaded = store.upload(name, file).await?;
    if let Err(error) = prune(store, keep).await {
        eprintln!("could not remove old backups: {}", error.as_str());
    }
    Ok(uploaded)
}

pub async fn status(app: &AppHandle) -> Result<BackupStatus> {
    let handle = app.clone();
    let (connected, has_passphrase, local_empty) = credentials(move || {
        Ok((
            Secret::RefreshToken.get()?.is_some(),
            Secret::Passphrase.get()?.is_some(),
            handle.state::<Database>().is_empty()?,
        ))
    })
    .await?;

    app.state::<BackupService>().read(|settings| BackupStatus {
        configured: OAuthClient::load().is_some(),
        connected,
        account: settings.account.clone(),
        has_passphrase,
        retention: settings.retention,
        last_backup_at: settings.last_backup_at.clone(),
        last_error: settings.last_error.clone(),
        local_empty,
    })
}

pub async fn connect(app: &AppHandle) -> Result<BackupStatus> {
    let client = oauth_client()?;
    let api = GoogleApi::current();
    let service = app.state::<BackupService>();

    let (cancel, cancelled) = oneshot::channel();
    *service.cancel_sign_in.lock().map_err(|e| AppError::from_message(e.to_string()))? = Some(cancel);

    let tokens = oauth::authorize(
        &api,
        &client,
        |url| {
            app.opener().open_url(url, None::<&str>).map_err(|e| {
                eprintln!("could not open the browser: {e}");
                AppError::code("browser_failed")
            })
        },
        cancelled,
    )
    .await?;

    let store = DriveStore::with_access_token(api, tokens.access).await?;
    let account = store.account().await?;
    let refresh = tokens.refresh;
    credentials(move || Secret::RefreshToken.set(&refresh)).await?;
    service.update(|settings| {
        settings.account = account;
        settings.last_error = None;
    })?;
    status(app).await
}

pub fn cancel_connect(app: &AppHandle) -> Result<()> {
    let service = app.state::<BackupService>();
    let cancel = service
        .cancel_sign_in
        .lock()
        .map_err(|e| AppError::from_message(e.to_string()))?
        .take();
    if let Some(cancel) = cancel {
        let _ = cancel.send(());
    }
    Ok(())
}

pub async fn disconnect(app: &AppHandle) -> Result<BackupStatus> {
    let service = app.state::<BackupService>();
    let _operation = service.operation.lock().await;
    credentials(|| Secret::RefreshToken.delete()).await?;
    service.update(|settings| {
        settings.account = None;
        settings.last_error = None;
        settings.last_hash = None;
    })?;
    status(app).await
}

pub async fn set_passphrase(app: &AppHandle, passphrase: String) -> Result<BackupStatus> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(AppError::code("passphrase_short"));
    }
    let service = app.state::<BackupService>();
    let _operation = service.operation.lock().await;
    credentials(move || Secret::Passphrase.set(&passphrase)).await?;
    // Data encrypted with the old passphrase should not count as already uploaded.
    service.update(|settings| settings.last_hash = None)?;
    status(app).await
}

pub fn set_retention(app: &AppHandle, retention: usize) -> Result<()> {
    if !RETENTION_CHOICES.contains(&retention) {
        return Err(AppError::code("generic"));
    }
    app.state::<BackupService>().update(|settings| settings.retention = retention)
}

pub async fn list() -> Result<Vec<RemoteBackup>> {
    open_store().await?.list().await
}

/// Returns whether a new copy was uploaded.
pub async fn run(app: &AppHandle, trigger: Trigger) -> Result<bool> {
    let service = app.state::<BackupService>();
    let _operation = service.operation.lock().await;
    let result = run_exclusive(app, &service, trigger).await;
    if let Err(error) = &result {
        service.update(|settings| settings.last_error = Some(error.as_str().to_string()))?;
    }
    result
}

async fn run_exclusive(app: &AppHandle, service: &BackupService, trigger: Trigger) -> Result<bool> {
    let (refresh, passphrase) =
        credentials(|| Ok((Secret::RefreshToken.get()?, Secret::Passphrase.get()?))).await?;

    // Closing is automatic, so a backup that was never set up is not a failure.
    if trigger == Trigger::Close && (refresh.is_none() || passphrase.is_none()) {
        return Ok(false);
    }
    if refresh.is_none() {
        return Err(AppError::code("drive_not_connected"));
    }
    let passphrase = passphrase.ok_or_else(|| AppError::code("passphrase_required"))?;

    let handle = app.clone();
    let (snapshot, stamp) = blocking(move || {
        let database = handle.state::<Database>();
        Ok((database.snapshot()?, database.timestamp()?))
    })
    .await?;

    let hash = Sha256::digest(&snapshot).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    if trigger == Trigger::Close {
        if service.read(|settings| settings.last_hash.as_deref() == Some(hash.as_str()))? {
            // Drive already holds this data, so any earlier failure no longer matters.
            service.update(|settings| settings.last_error = None)?;
            return Ok(false);
        }
        let _ = app.emit(CLOSING_EVENT, ());
    }

    let file = blocking(move || crypto::encrypt(&passphrase, &snapshot)).await?;
    let store = open_store().await?;
    let keep = service.read(|settings| settings.retention)?;
    let name = format!("inspectie-auto-{stamp}{BACKUP_SUFFIX}");
    let uploaded = upload_and_prune(&store, &name, file, keep).await?;

    service.update(|settings| {
        settings.last_backup_at = Some(uploaded.created_time);
        settings.last_error = None;
        settings.last_hash = Some(hash);
    })?;
    Ok(true)
}

/// Backs up as the app closes, recording a timeout like any other failure.
pub async fn run_on_close(app: &AppHandle) {
    if tokio::time::timeout(CLOSE_LIMIT, run(app, Trigger::Close)).await.is_err() {
        let service = app.state::<BackupService>();
        let code = "drive_offline".to_string();
        let _ = service.update(|settings| settings.last_error = Some(code));
    }
}

/// Replaces the local database and returns where the previous one was kept.
pub async fn restore(app: &AppHandle, id: String, passphrase: Option<String>) -> Result<String> {
    let service = app.state::<BackupService>();
    let _operation = service.operation.lock().await;

    let stored = credentials(|| Secret::Passphrase.get()).await?;
    let key = passphrase
        .clone()
        .or_else(|| stored.clone())
        .ok_or_else(|| AppError::code("passphrase_required"))?;

    let file = open_store().await?.download(&id).await?;

    let handle = app.clone();
    let aside = blocking(move || {
        let plaintext = crypto::decrypt(&key, &file)?;
        handle.state::<Database>().restore(&plaintext)
    })
    .await?;

    // An older backup may use an older passphrase, which must not replace the current one.
    if let (Some(passphrase), None) = (passphrase, stored) {
        credentials(move || Secret::Passphrase.set(&passphrase)).await?;
    }
    service.update(|settings| settings.last_hash = None)?;
    Ok(aside.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;

    #[derive(Default)]
    struct MemoryStore {
        files: RefCell<Vec<RemoteBackup>>,
        deleted: RefCell<HashSet<String>>,
        fail_uploads: bool,
    }

    impl MemoryStore {
        fn with(count: usize) -> Self {
            let store = Self::default();
            for index in 0..count {
                store.files.borrow_mut().push(backup(index));
            }
            store
        }
    }

    fn backup(index: usize) -> RemoteBackup {
        RemoteBackup {
            id: index.to_string(),
            name: format!("{index}{BACKUP_SUFFIX}"),
            created_time: format!("2026-11-08T10:{index:02}:00.000Z"),
            size: None,
        }
    }

    impl BackupStore for MemoryStore {
        async fn list(&self) -> Result<Vec<RemoteBackup>> {
            Ok(self.files.borrow().clone())
        }

        async fn upload(&self, _name: &str, _bytes: Vec<u8>) -> Result<RemoteBackup> {
            if self.fail_uploads {
                return Err(AppError::code("drive_offline"));
            }
            let created = backup(self.files.borrow().len());
            self.files.borrow_mut().push(created.clone());
            Ok(created)
        }

        async fn download(&self, _id: &str) -> Result<Vec<u8>> {
            Ok(Vec::new())
        }

        async fn delete(&self, id: &str) -> Result<()> {
            self.files.borrow_mut().retain(|file| file.id != id);
            self.deleted.borrow_mut().insert(id.to_string());
            Ok(())
        }
    }

    fn run_async<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn keeps_only_the_newest_copies() {
        let store = MemoryStore::with(3);
        run_async(upload_and_prune(&store, "new", vec![], 2)).unwrap();
        let kept: Vec<String> = store.files.borrow().iter().map(|file| file.id.clone()).collect();
        assert_eq!(kept, ["2", "3"]);
    }

    #[test]
    fn a_failed_upload_deletes_nothing() {
        let mut store = MemoryStore::with(3);
        store.fail_uploads = true;
        assert!(run_async(upload_and_prune(&store, "new", vec![], 1)).is_err());
        assert!(store.deleted.borrow().is_empty());
    }

    #[test]
    fn settings_survive_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        let service = BackupService::new(directory.path());
        service.update(|settings| settings.retention = 20).unwrap();
        let reopened = BackupService::new(directory.path());
        assert_eq!(reopened.read(|settings| settings.retention).unwrap(), 20);
    }

    #[test]
    fn a_damaged_settings_file_falls_back_to_defaults() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("backup-settings.json"), "not json").unwrap();
        let service = BackupService::new(directory.path());
        assert_eq!(service.read(|settings| settings.retention).unwrap(), DEFAULT_RETENTION);
    }

    #[test]
    fn only_the_first_close_waits() {
        let directory = tempfile::tempdir().unwrap();
        let service = BackupService::new(directory.path());
        assert!(service.begin_closing());
        assert!(!service.begin_closing());
    }
}
