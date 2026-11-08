mod backup;
mod commands;
mod data;
mod db;
mod reports;
mod sms;

use std::fs;

use backup::BackupService;
use db::Database;
use sms::SmsService;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let database = Database::open(&data_dir.join("vehicle-inspection.db"))?;
            app.manage(database);
            app.manage(BackupService::new(&data_dir));
            app.manage(SmsService::new(&data_dir));
            Ok(())
        })
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else { return };
            if !window.state::<BackupService>().begin_closing() {
                return;
            }
            api.prevent_close();
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                backup::run_on_close(&app).await;
                app.exit(0);
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::database_info,
            commands::list_clients,
            commands::list_cars,
            commands::list_appointments,
            commands::appointments_between,
            commands::client_options,
            commands::car_options,
            commands::save_client,
            commands::save_car,
            commands::save_appointment,
            commands::set_last_revision,
            commands::preview_delete_client,
            commands::preview_delete_car,
            commands::delete_client,
            commands::delete_car,
            commands::delete_appointment,
            commands::report,
            commands::sms_pending,
            commands::sms_send,
            commands::sms_stop,
            commands::sms_progress,
            commands::sms_history,
            commands::sms_templates,
            commands::sms_save_template,
            commands::sms_gateway_settings,
            commands::sms_save_gateway_settings,
            commands::sms_test_gateway,
            commands::export_report,
            commands::backup_status,
            commands::backup_connect,
            commands::backup_cancel_connect,
            commands::backup_disconnect,
            commands::backup_set_passphrase,
            commands::backup_set_retention,
            commands::backup_now,
            commands::backup_list,
            commands::backup_restore,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
