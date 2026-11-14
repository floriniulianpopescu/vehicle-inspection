use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::backup::{self, BackupStatus, RemoteBackup, Trigger};
use crate::data::{
    self, AppError, Car, CarFilter, CarInput, Client, ClientFilter, ClientInput, DeletePreview,
    Page, PickerOption,
};
use crate::db::{Database, DatabaseInfo};
use crate::whatsapp::{self, Connection};
use crate::sms::{self, GatewaySettings, PendingMessage, SendProgress, SentMessage, Template};
use crate::reports::{self, ExportLabels, Report, ReportRequest};

type Db<'a> = State<'a, Database>;

#[tauri::command]
pub fn database_info(db: Db<'_>) -> Result<DatabaseInfo, String> {
    db.info()
}

#[tauri::command]
pub fn list_clients(db: Db<'_>, filter: ClientFilter) -> Result<Page<Client>, AppError> {
    db.with(|conn| data::list_clients(conn, filter))
}

#[tauri::command]
pub fn list_cars(db: Db<'_>, filter: CarFilter) -> Result<Page<Car>, AppError> {
    db.with(|conn| data::list_cars(conn, filter))
}

#[tauri::command]
pub fn client_options(db: Db<'_>, search: String, linked_to: Option<i64>) -> Result<Vec<PickerOption>, AppError> {
    db.with(|conn| data::client_options(conn, &search, linked_to))
}

#[tauri::command]
pub fn car_options(db: Db<'_>, search: String, linked_to: Option<i64>) -> Result<Vec<PickerOption>, AppError> {
    db.with(|conn| data::car_options(conn, &search, linked_to))
}

#[tauri::command]
pub fn save_client(db: Db<'_>, input: ClientInput) -> Result<PickerOption, AppError> {
    db.with(|conn| data::save_client(conn, input))
}

#[tauri::command]
pub fn save_car(db: Db<'_>, input: CarInput) -> Result<PickerOption, AppError> {
    db.with(|conn| data::save_car(conn, input))
}

#[tauri::command]
pub fn preview_delete_client(db: Db<'_>, id: i64) -> Result<DeletePreview, AppError> {
    db.with(|conn| data::preview_delete_client(conn, id))
}

#[tauri::command]
pub fn preview_delete_car(db: Db<'_>, id: i64) -> Result<DeletePreview, AppError> {
    db.with(|conn| data::preview_delete_car(conn, id))
}

#[tauri::command]
pub fn delete_client(db: Db<'_>, id: i64) -> Result<(), AppError> {
    db.with(|conn| data::delete_client(conn, id))
}

#[tauri::command]
pub fn delete_car(db: Db<'_>, id: i64) -> Result<(), AppError> {
    db.with(|conn| data::delete_car(conn, id))
}

#[tauri::command]
pub async fn backup_status(app: AppHandle) -> Result<BackupStatus, AppError> {
    backup::status(&app).await
}

#[tauri::command]
pub async fn backup_connect(app: AppHandle) -> Result<BackupStatus, AppError> {
    backup::connect(&app).await
}

#[tauri::command]
pub fn backup_cancel_connect(app: AppHandle) -> Result<(), AppError> {
    backup::cancel_connect(&app)
}

#[tauri::command]
pub async fn backup_disconnect(app: AppHandle) -> Result<BackupStatus, AppError> {
    backup::disconnect(&app).await
}

#[tauri::command]
pub async fn backup_set_passphrase(app: AppHandle, passphrase: String) -> Result<BackupStatus, AppError> {
    backup::set_passphrase(&app, passphrase).await
}

#[tauri::command]
pub fn backup_set_retention(app: AppHandle, retention: usize) -> Result<(), AppError> {
    backup::set_retention(&app, retention)
}

#[tauri::command]
pub async fn backup_now(app: AppHandle) -> Result<BackupStatus, AppError> {
    backup::run(&app, Trigger::Manual).await?;
    backup::status(&app).await
}

#[tauri::command]
pub async fn backup_list() -> Result<Vec<RemoteBackup>, AppError> {
    backup::list().await
}

#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    id: String,
    passphrase: Option<String>,
) -> Result<String, AppError> {
    backup::restore(&app, id, passphrase).await
}

#[tauri::command]
pub fn report(db: Db<'_>, request: ReportRequest) -> Result<Report, AppError> {
    db.with(|conn| reports::build(conn, &request))
}

/// Returns where the file was saved, or nothing if the dialog was cancelled.
#[tauri::command]
pub async fn export_report(
    app: AppHandle,
    request: ReportRequest,
    labels: ExportLabels,
    file_name: String,
) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_file_name(&file_name)
            .add_filter("Excel", &["xlsx"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|e| AppError::from_message(e.to_string()))?;

        let report = app.state::<Database>().with(|conn| reports::build(conn, &request))?;
        let bytes = reports::workbook_bytes(&report, &labels)
            .map_err(|e| AppError::from_message(e.to_string()))?;
        reports::save_workbook(path, &bytes).map(Some)
    })
    .await
    .map_err(|e| AppError::from_message(e.to_string()))?
}

#[tauri::command]
pub fn sms_reminder_days(app: AppHandle) -> Result<i64, AppError> {
    sms::reminder_days(&app)
}

#[tauri::command]
pub fn sms_set_reminder_days(app: AppHandle, days: i64) -> Result<(), AppError> {
    sms::set_reminder_days(&app, days)
}

#[tauri::command]
pub fn sms_interval_seconds(app: AppHandle, channel: String) -> Result<u64, AppError> {
    sms::interval_seconds(&app, &channel)
}

#[tauri::command]
pub async fn whatsapp_status(app: AppHandle) -> Result<Connection, AppError> {
    whatsapp::status(&app).await
}

#[tauri::command]
pub async fn whatsapp_open(app: AppHandle) -> Result<(), AppError> {
    whatsapp::open(&app)
}

#[tauri::command]
pub async fn whatsapp_log_out(app: AppHandle) -> Result<(), AppError> {
    whatsapp::log_out(&app)
}

#[tauri::command]
pub fn sms_pending(app: AppHandle) -> Result<Vec<PendingMessage>, AppError> {
    sms::pending_messages(&app)
}

#[tauri::command]
pub async fn sms_send(app: AppHandle, keys: Vec<String>, interval_seconds: u64) -> Result<(), AppError> {
    sms::start_sending(&app, keys, interval_seconds).await
}

#[tauri::command]
pub fn sms_stop(app: AppHandle) {
    sms::stop_sending(&app);
}

#[tauri::command]
pub fn sms_progress(app: AppHandle) -> Result<SendProgress, AppError> {
    sms::progress(&app)
}

#[tauri::command]
pub fn sms_history(db: Db<'_>, page: i64) -> Result<Page<SentMessage>, AppError> {
    db.with(|conn| sms::history(conn, page))
}

#[tauri::command]
pub fn sms_templates(db: Db<'_>) -> Result<Vec<Template>, AppError> {
    db.with(|conn| sms::templates(conn))
}

#[tauri::command]
pub fn sms_save_template(db: Db<'_>, template: Template) -> Result<(), AppError> {
    db.with(|conn| sms::save_template(conn, template))
}

#[tauri::command]
pub async fn sms_gateway_settings(app: AppHandle) -> Result<GatewaySettings, AppError> {
    sms::gateway_settings(&app).await
}

#[tauri::command]
pub async fn sms_save_gateway_settings(
    app: AppHandle,
    address: String,
    username: String,
    password: Option<String>,
) -> Result<GatewaySettings, AppError> {
    sms::save_gateway_settings(&app, address, username, password).await
}

#[tauri::command]
pub async fn sms_test_gateway(app: AppHandle) -> Result<(), AppError> {
    sms::test_gateway(&app).await
}
