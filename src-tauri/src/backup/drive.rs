//! Google Drive as the backup destination.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::Response;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::oauth::{self, GoogleApi};
use crate::data::AppError;

const FOLDER_NAME: &str = "Inspectie Auto - copii de siguranta";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
pub const BACKUP_SUFFIX: &str = ".db.enc";
const FILE_FIELDS: &str = "id,name,size,createdTime";
const MAX_LISTED: u32 = 100;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackup {
    pub id: String,
    pub name: String,
    pub created_time: String,
    /// Drive sends this as text.
    pub size: Option<String>,
}

/// What the backup logic needs from a cloud provider.
pub trait BackupStore {
    /// Newest first.
    async fn list(&self) -> Result<Vec<RemoteBackup>, AppError>;
    async fn upload(&self, name: &str, bytes: Vec<u8>) -> Result<RemoteBackup, AppError>;
    async fn download(&self, id: &str) -> Result<Vec<u8>, AppError>;
    async fn delete(&self, id: &str) -> Result<(), AppError>;
}

pub struct DriveStore {
    http: reqwest::Client,
    api: GoogleApi,
    token: String,
    folder: String,
}

#[derive(Deserialize)]
struct FileList<T> {
    files: Vec<T>,
}

#[derive(Deserialize)]
struct FolderId {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct About {
    user: AboutUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AboutUser {
    email_address: Option<String>,
}

async fn checked(response: Response) -> Result<Response, AppError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    eprintln!("drive request rejected: {status}");
    Err(AppError::code(match status.as_u16() {
        401 => "drive_reauth",
        403 if body.contains("storageQuotaExceeded") => "drive_full",
        _ => "drive_error",
    }))
}

fn multipart_body(boundary: &str, metadata: &str, content: &[u8]) -> Vec<u8> {
    let mut body = format!(
        "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(content);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

impl DriveStore {
    pub async fn with_access_token(api: GoogleApi, token: String) -> Result<Self, AppError> {
        let mut store = Self { http: oauth::http_client()?, api, token, folder: String::new() };
        store.folder = store.find_or_create_folder().await?;
        Ok(store)
    }

    async fn find_or_create_folder(&self) -> Result<String, AppError> {
        let query = format!("name='{FOLDER_NAME}' and mimeType='{FOLDER_MIME}' and trashed=false");
        let found: FileList<FolderId> = checked(
            self.http
                .get(format!("{}/files", self.api.drive))
                .bearer_auth(&self.token)
                .query(&[("q", query.as_str()), ("fields", "files(id)"), ("orderBy", "createdTime")])
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .json()
        .await
        .map_err(oauth::offline)?;
        if let Some(folder) = found.files.into_iter().next() {
            return Ok(folder.id);
        }

        let created: FolderId = checked(
            self.http
                .post(format!("{}/files", self.api.drive))
                .bearer_auth(&self.token)
                .query(&[("fields", "id")])
                .json(&json!({ "name": FOLDER_NAME, "mimeType": FOLDER_MIME }))
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .json()
        .await
        .map_err(oauth::offline)?;
        Ok(created.id)
    }

    pub async fn account(&self) -> Result<Option<String>, AppError> {
        let about: About = checked(
            self.http
                .get(format!("{}/about", self.api.drive))
                .bearer_auth(&self.token)
                .query(&[("fields", "user(emailAddress)")])
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .json()
        .await
        .map_err(oauth::offline)?;
        Ok(about.user.email_address)
    }
}

impl BackupStore for DriveStore {
    async fn list(&self) -> Result<Vec<RemoteBackup>, AppError> {
        let query = format!("'{}' in parents and trashed=false", self.folder);
        let fields = format!("files({FILE_FIELDS})");
        let page_size = MAX_LISTED.to_string();
        let found: FileList<RemoteBackup> = checked(
            self.http
                .get(format!("{}/files", self.api.drive))
                .bearer_auth(&self.token)
                .query(&[
                    ("q", query.as_str()),
                    ("fields", fields.as_str()),
                    ("orderBy", "createdTime desc"),
                    ("pageSize", page_size.as_str()),
                ])
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .json()
        .await
        .map_err(oauth::offline)?;
        Ok(found.files.into_iter().filter(|file| file.name.ends_with(BACKUP_SUFFIX)).collect())
    }

    async fn upload(&self, name: &str, bytes: Vec<u8>) -> Result<RemoteBackup, AppError> {
        let mut random = [0u8; 18];
        getrandom::fill(&mut random).map_err(|e| AppError::from_message(e.to_string()))?;
        let boundary = URL_SAFE_NO_PAD.encode(random);
        let metadata = json!({ "name": name, "parents": [self.folder] }).to_string();

        checked(
            self.http
                .post(format!("{}/files", self.api.upload))
                .bearer_auth(&self.token)
                .query(&[("uploadType", "multipart"), ("fields", FILE_FIELDS)])
                .header("Content-Type", format!("multipart/related; boundary={boundary}"))
                .body(multipart_body(&boundary, &metadata, &bytes))
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .json()
        .await
        .map_err(oauth::offline)
    }

    async fn download(&self, id: &str) -> Result<Vec<u8>, AppError> {
        let bytes = checked(
            self.http
                .get(format!("{}/files/{id}", self.api.drive))
                .bearer_auth(&self.token)
                .query(&[("alt", "media")])
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?
        .bytes()
        .await
        .map_err(oauth::offline)?;
        Ok(bytes.to_vec())
    }

    async fn delete(&self, id: &str) -> Result<(), AppError> {
        checked(
            self.http
                .delete(format!("{}/files/{id}", self.api.drive))
                .bearer_auth(&self.token)
                .send()
                .await
                .map_err(oauth::offline)?,
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_keeps_binary_content_intact() {
        let body = multipart_body("B", "{}", &[0, 255, 13, 10]);
        let expected = b"--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--B\r\nContent-Type: application/octet-stream\r\n\r\n\x00\xff\r\n\r\n--B--\r\n";
        assert_eq!(body, expected);
    }

    #[test]
    fn reads_drive_file_fields() {
        let file: RemoteBackup = serde_json::from_str(
            r#"{"id":"1","name":"a.db.enc","size":"42","createdTime":"2026-11-08T10:00:00.000Z"}"#,
        )
        .unwrap();
        assert_eq!(file.created_time, "2026-11-08T10:00:00.000Z");
        assert_eq!(file.size.as_deref(), Some("42"));
    }
}
