use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;

use crate::data::AppError;

/// Applied in order. A database's `user_version` records how many have run.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_initial.sql")];

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    path: String,
    schema_version: u32,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        prepare(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    pub fn with<T>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut conn = self.conn.lock().map_err(|e| AppError::from_message(e.to_string()))?;
        action(&mut conn)
    }

    pub fn info(&self) -> Result<DatabaseInfo, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Ok(DatabaseInfo {
            path: self.path.display().to_string(),
            schema_version: schema_version(&conn)?,
        })
    }
}

fn prepare(conn: &mut Connection) -> Result<(), String> {
    // SQLite leaves foreign keys off unless each connection enables them.
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    migrate(conn)
}

fn schema_version(conn: &Connection) -> Result<u32, String> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn migrate(conn: &mut Connection) -> Result<(), String> {
    let current = schema_version(conn)? as usize;
    if current > MIGRATIONS.len() {
        return Err(format!(
            "Database schema version {current} is newer than this app supports ({})",
            MIGRATIONS.len()
        ));
    }

    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| e.to_string())?;
        tx.pragma_update(None, "user_version", (index + 1) as u32)
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
pub fn test_connection() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    prepare(&mut conn).unwrap();
    conn
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn database() -> Connection {
        test_connection()
    }

    fn add_client(conn: &Connection, phone: &str) -> rusqlite::Result<usize> {
        conn.execute("INSERT INTO clients (Phone) VALUES (?1)", params![phone])
    }

    fn add_car(conn: &Connection, plate: &str, frequency: i64) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO cars (Plate, Manufacturer, Model, RevisionFrequency)
             VALUES (?1, 'Dacia', 'Logan', ?2)",
            params![plate, frequency],
        )
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }

    fn book(conn: &Connection, client: i64, car: i64) -> rusqlite::Result<usize> {
        conn.execute(
            "INSERT INTO appointments (ClientID, CarID, TimeDate, Duration)
             VALUES (?1, ?2, '2026-11-09T09:30', 30)",
            params![client, car],
        )
    }

    #[test]
    fn migrating_twice_is_harmless() {
        let mut conn = database();
        migrate(&mut conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap() as usize, MIGRATIONS.len());
    }

    #[test]
    fn rejects_database_from_newer_app() {
        let mut conn = database();
        conn.pragma_update(None, "user_version", MIGRATIONS.len() as u32 + 1)
            .unwrap();
        assert!(migrate(&mut conn).is_err());
    }

    #[test]
    fn phone_is_unique() {
        let conn = database();
        add_client(&conn, "0722000000").unwrap();
        assert!(add_client(&conn, "0722000000").is_err());
    }

    #[test]
    fn plate_is_unique_and_normalized() {
        let conn = database();
        add_car(&conn, "B123ABC", 12).unwrap();
        assert!(add_car(&conn, "B123ABC", 12).is_err());
        assert!(add_car(&conn, "b 456 abc", 12).is_err());
    }

    #[test]
    fn revision_frequency_is_limited() {
        let conn = database();
        for months in [6, 12, 24] {
            add_car(&conn, &format!("B{months}ABC"), months).unwrap();
        }
        assert!(add_car(&conn, "B18ABC", 18).is_err());
    }

    #[test]
    fn car_client_link_exists_once() {
        let conn = database();
        add_client(&conn, "0722000000").unwrap();
        add_car(&conn, "B123ABC", 12).unwrap();
        let link = "INSERT INTO carsclients (CarID, ClientID) VALUES (1, 1)";
        conn.execute(link, []).unwrap();
        assert!(conn.execute(link, []).is_err());
    }

    #[test]
    fn appointment_needs_existing_client_and_car() {
        let conn = database();
        assert!(book(&conn, 1, 1).is_err());
    }

    #[test]
    fn deleting_a_car_removes_its_links_and_appointments_but_not_clients() {
        let conn = database();
        add_client(&conn, "0722000000").unwrap();
        add_car(&conn, "B123ABC", 12).unwrap();
        conn.execute("INSERT INTO carsclients (CarID, ClientID) VALUES (1, 1)", [])
            .unwrap();
        book(&conn, 1, 1).unwrap();

        conn.execute("DELETE FROM cars WHERE CarID = 1", []).unwrap();

        assert_eq!(count(&conn, "carsclients"), 0);
        assert_eq!(count(&conn, "appointments"), 0);
        assert_eq!(count(&conn, "clients"), 1);
    }
}
