mod commands;
mod data;
mod db;

use std::fs;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let database = Database::open(&data_dir.join("vehicle-inspection.db"))?;
            app.manage(database);
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
