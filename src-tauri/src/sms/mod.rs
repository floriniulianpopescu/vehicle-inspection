//! Reviewed, paced SMS sending through an Android phone.

mod gateway;
mod pending;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::backup::credentials;
use crate::backup::secrets::Secret;
use crate::data::AppError;
use crate::db::Database;
use gateway::{Gateway, Outcome};
pub use pending::{PendingMessage, SentMessage, Template, history, save_template, templates};

const SEND_INTERVAL: Duration = Duration::from_secs(30);
const PROGRESS_EVENT: &str = "sms-progress";

#[cfg(debug_assertions)]
const INTERVAL_OVERRIDE_VAR: &str = "VEHICLE_INSPECTION_SMS_INTERVAL_MS";

type Result<T> = std::result::Result<T, AppError>;

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
struct StoredSettings {
    address: String,
    username: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySettings {
    address: String,
    username: String,
    has_password: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SendProgress {
    active: bool,
    total: usize,
    done: usize,
    sent: usize,
    failed: usize,
    error: Option<String>,
}

pub struct SmsService {
    settings_path: PathBuf,
    settings: Mutex<StoredSettings>,
    progress: Mutex<SendProgress>,
    stop_requested: AtomicBool,
    stop_signal: Notify,
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> AppError {
    AppError::from_message(error.to_string())
}

fn send_interval() -> Duration {
    #[cfg(debug_assertions)]
    if let Some(milliseconds) =
        std::env::var(INTERVAL_OVERRIDE_VAR).ok().and_then(|value| value.parse().ok())
    {
        return Duration::from_millis(milliseconds);
    }
    SEND_INTERVAL
}

impl SmsService {
    pub fn new(data_dir: &Path) -> Self {
        let settings_path = data_dir.join("sms-settings.json");
        let settings = fs::read(&settings_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self {
            settings_path,
            settings: Mutex::new(settings),
            progress: Mutex::new(SendProgress::default()),
            stop_requested: AtomicBool::new(false),
            stop_signal: Notify::new(),
        }
    }

    fn stored(&self) -> Result<StoredSettings> {
        Ok(self.settings.lock().map_err(lock_error)?.clone())
    }

    fn store(&self, next: StoredSettings) -> Result<()> {
        let text = serde_json::to_vec_pretty(&next).map_err(|e| AppError::from_message(e.to_string()))?;
        let temporary = self.settings_path.with_extension("json.tmp");
        fs::write(&temporary, text)
            .and_then(|()| fs::rename(&temporary, &self.settings_path))
            .map_err(|e| AppError::from_message(e.to_string()))?;
        *self.settings.lock().map_err(lock_error)? = next;
        Ok(())
    }

    /// Claims the single send slot, or fails if a batch is already running.
    fn begin(&self, total: usize) -> Result<()> {
        let mut progress = self.progress.lock().map_err(lock_error)?;
        if progress.active {
            return Err(AppError::code("sms_busy"));
        }
        *progress = SendProgress { active: true, total, ..SendProgress::default() };
        self.stop_requested.store(false, Ordering::SeqCst);
        Ok(())
    }
}

pub async fn gateway_settings(app: &AppHandle) -> Result<GatewaySettings> {
    let stored = app.state::<SmsService>().stored()?;
    let has_password = credentials(|| Secret::SmsGatewayPassword.get()).await?.is_some();
    Ok(GatewaySettings { address: stored.address, username: stored.username, has_password })
}

/// Leaves the saved password alone when none is given.
pub async fn save_gateway_settings(
    app: &AppHandle,
    address: String,
    username: String,
    password: Option<String>,
) -> Result<GatewaySettings> {
    gateway::normalize_address(&address)?;
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err(AppError::code("required_fields"));
    }
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        credentials(move || Secret::SmsGatewayPassword.set(&password)).await?;
    }
    app.state::<SmsService>().store(StoredSettings { address: address.trim().to_string(), username })?;
    gateway_settings(app).await
}

async fn open_gateway(app: &AppHandle) -> Result<Gateway> {
    let stored = app.state::<SmsService>().stored()?;
    let password = credentials(|| Secret::SmsGatewayPassword.get()).await?;
    match password {
        Some(password) if !stored.address.is_empty() && !stored.username.is_empty() => {
            Gateway::new(&stored.address, stored.username, password)
        }
        _ => Err(AppError::code("sms_not_configured")),
    }
}

pub async fn test_gateway(app: &AppHandle) -> Result<()> {
    open_gateway(app).await?.check().await
}

pub fn pending_messages(app: &AppHandle) -> Result<Vec<PendingMessage>> {
    app.state::<Database>().with(|conn| pending::pending(conn))
}

pub fn progress(app: &AppHandle) -> Result<SendProgress> {
    Ok(app.state::<SmsService>().progress.lock().map_err(lock_error)?.clone())
}

fn update_progress(app: &AppHandle, change: impl FnOnce(&mut SendProgress)) -> Result<()> {
    let snapshot = {
        let service = app.state::<SmsService>();
        let mut progress = service.progress.lock().map_err(lock_error)?;
        change(&mut progress);
        progress.clone()
    };
    let _ = app.emit(PROGRESS_EVENT, snapshot);
    Ok(())
}

/// Starts sending in the background and returns immediately.
pub async fn start_sending(app: &AppHandle, keys: Vec<String>) -> Result<()> {
    if keys.is_empty() {
        return Ok(());
    }
    let gateway = open_gateway(app).await?;
    gateway.check().await?;
    app.state::<SmsService>().begin(keys.len())?;
    update_progress(app, |_| {})?;

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let error = send_batch(&app, &gateway, &keys).await.err();
        let _ = update_progress(&app, |progress| {
            progress.active = false;
            progress.error = error.map(|code| code.as_str().to_string());
        });
    });
    Ok(())
}

/// True if the wait ended because staff pressed stop.
async fn wait_or_stop(service: &SmsService, interval: Duration) -> bool {
    if service.stop_requested.load(Ordering::SeqCst) {
        return true;
    }
    tokio::select! {
        _ = tokio::time::sleep(interval) => {}
        _ = service.stop_signal.notified() => {}
    }
    service.stop_requested.load(Ordering::SeqCst)
}

async fn send_batch(app: &AppHandle, gateway: &Gateway, keys: &[String]) -> Result<()> {
    let service = app.state::<SmsService>();
    let interval = send_interval();
    let mut must_wait = false;

    for key in keys {
        // A batch can run for hours, so each message is re-checked: the client
        // may have opted out, booked or been deleted since staff pressed Send.
        let current = pending_messages(app)?;
        let Some(message) = current.iter().find(|candidate| &candidate.key == key) else {
            update_progress(app, |progress| progress.done += 1)?;
            continue;
        };

        if must_wait && wait_or_stop(&service, interval).await {
            break;
        }
        if service.stop_requested.load(Ordering::SeqCst) {
            break;
        }

        let outcome = gateway.send(&message.phone, &message.text).await?;
        let sent = outcome == Outcome::Sent;
        app.state::<Database>().with(|conn| pending::record(conn, message, sent))?;
        update_progress(app, |progress| {
            progress.done += 1;
            if sent {
                progress.sent += 1;
            } else {
                progress.failed += 1;
            }
        })?;
        must_wait = true;
    }
    Ok(())
}

pub fn stop_sending(app: &AppHandle) {
    let service = app.state::<SmsService>();
    service.stop_requested.store(true, Ordering::SeqCst);
    service.stop_signal.notify_waiters();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_batch_runs_at_a_time() {
        let directory = tempfile::tempdir().unwrap();
        let service = SmsService::new(directory.path());
        service.begin(3).unwrap();
        assert_eq!(service.begin(1), Err(AppError::code("sms_busy")));
    }

    #[test]
    fn settings_survive_a_restart() {
        let directory = tempfile::tempdir().unwrap();
        let service = SmsService::new(directory.path());
        service
            .store(StoredSettings { address: "192.168.1.50".into(), username: "sms".into() })
            .unwrap();
        let reopened = SmsService::new(directory.path());
        assert_eq!(reopened.stored().unwrap().address, "192.168.1.50");
    }
}
