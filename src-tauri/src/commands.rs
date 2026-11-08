use tauri::State;

use crate::data::{
    self, Appointment, AppointmentFilter, AppointmentInput, AppError, Car, CarFilter, CarInput,
    Client, ClientFilter, ClientInput, DeletePreview, Page, PickerOption, SaveAppointmentResult,
};
use crate::db::{Database, DatabaseInfo};

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
pub fn list_appointments(db: Db<'_>, filter: AppointmentFilter) -> Result<Page<Appointment>, AppError> {
    db.with(|conn| data::list_appointments(conn, filter))
}

#[tauri::command]
pub fn appointments_between(db: Db<'_>, from: String, to: String) -> Result<Vec<Appointment>, AppError> {
    db.with(|conn| data::appointments_between(conn, &from, &to))
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
pub fn save_appointment(db: Db<'_>, input: AppointmentInput) -> Result<SaveAppointmentResult, AppError> {
    db.with(|conn| data::save_appointment(conn, input))
}

#[tauri::command]
pub fn set_last_revision(db: Db<'_>, car_id: i64, value: Option<String>) -> Result<(), AppError> {
    db.with(|conn| data::set_last_revision(conn, car_id, value))
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
pub fn delete_appointment(db: Db<'_>, id: i64) -> Result<(), AppError> {
    db.with(|conn| data::delete_appointment(conn, id))
}
