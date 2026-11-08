use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::data::AppError;

/// Applied in order. A database's `user_version` records how many have run.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_initial.sql"),
    include_str!("../migrations/002_auto_sms.sql"),
];

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

    pub fn is_empty(&self) -> Result<bool, AppError> {
        self.with(|conn| {
            Ok(conn.query_row(
                "SELECT NOT EXISTS (SELECT 1 FROM clients) AND NOT EXISTS (SELECT 1 FROM cars)",
                [],
                |row| row.get(0),
            )?)
        })
    }

    /// Local time, formatted for use in file names.
    pub fn timestamp(&self) -> Result<String, AppError> {
        self.with(|conn| {
            Ok(conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')", [], |row| {
                row.get(0)
            })?)
        })
    }

    fn sibling(&self, name: &str) -> PathBuf {
        self.path.with_file_name(name)
    }

    /// A consistent copy of the whole database as file contents.
    pub fn snapshot(&self) -> Result<Vec<u8>, AppError> {
        let target = self.sibling("backup-snapshot.tmp");
        let result = self
            .with(|conn| vacuum_into(conn, &target))
            .and_then(|()| fs::read(&target).map_err(io_error));
        let _ = fs::remove_file(&target);
        result
    }

    /// Replaces the contents with a backup, keeping the previous data in a separate
    /// file whose path is returned. Nothing changes if the backup is unusable.
    pub fn restore(&self, contents: &[u8]) -> Result<PathBuf, AppError> {
        let incoming = self.sibling("backup-incoming.tmp");
        fs::write(&incoming, contents).map_err(io_error)?;
        let result = self.restore_from(&incoming);
        let _ = fs::remove_file(&incoming);
        result
    }

    fn restore_from(&self, incoming: &Path) -> Result<PathBuf, AppError> {
        let source = Connection::open_with_flags(incoming, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| AppError::code("backup_invalid"))?;
        validate_backup(&source)?;

        let stamp = self.timestamp()?;
        let aside = self.sibling(&format!("vehicle-inspection.before-restore-{stamp}.db"));
        self.with(|conn| {
            vacuum_into(conn, &aside)?;
            Backup::new(&source, conn)?.run_to_completion(256, Duration::ZERO, None)?;
            migrate(conn).map_err(AppError::from_message)
        })?;
        Ok(aside)
    }
}

fn io_error(error: std::io::Error) -> AppError {
    AppError::from_message(error.to_string())
}

fn vacuum_into(conn: &Connection, target: &Path) -> Result<(), AppError> {
    let _ = fs::remove_file(target);
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
    Ok(())
}

fn validate_backup(source: &Connection) -> Result<(), AppError> {
    let invalid = |_| AppError::code("backup_invalid");

    let integrity: String = source
        .query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))
        .map_err(invalid)?;
    let tables: i64 = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
             AND name IN ('clients', 'cars', 'carsclients', 'appointments')",
            [],
            |row| row.get(0),
        )
        .map_err(invalid)?;
    if integrity != "ok" || tables != 4 {
        return Err(AppError::code("backup_invalid"));
    }

    let version = source
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(invalid)?;
    if version > MIGRATIONS.len() as i64 {
        return Err(AppError::code("backup_newer"));
    }
    Ok(())
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

    fn file_database() -> (tempfile::TempDir, Database) {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(&directory.path().join("test.db")).unwrap();
        (directory, database)
    }

    fn add_phone(database: &Database, phone: &str) {
        database.with(|conn| Ok(add_client(conn, phone)?)).unwrap();
    }

    fn phones(database: &Database) -> Vec<String> {
        database
            .with(|conn| {
                let mut query = conn.prepare("SELECT Phone FROM clients ORDER BY Phone")?;
                let rows = query.query_map([], |row| row.get(0))?;
                Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
            })
            .unwrap()
    }

    fn leftover_temporary_files(directory: &tempfile::TempDir) -> usize {
        fs::read_dir(directory.path())
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
            .count()
    }

    #[test]
    fn restore_replaces_data_and_keeps_the_previous_file() {
        let (directory, database) = file_database();
        add_phone(&database, "0722000001");
        let snapshot = database.snapshot().unwrap();
        add_phone(&database, "0722000002");

        let aside = database.restore(&snapshot).unwrap();

        assert_eq!(phones(&database), ["0722000001"]);
        let previous = Database::open(&aside).unwrap();
        assert_eq!(phones(&previous), ["0722000001", "0722000002"]);
        assert_eq!(leftover_temporary_files(&directory), 0);
    }

    #[test]
    fn restored_database_still_enforces_foreign_keys() {
        let (_directory, database) = file_database();
        let snapshot = database.snapshot().unwrap();
        database.restore(&snapshot).unwrap();
        assert!(database.with(|conn| Ok(book(conn, 99, 99)?)).is_err());
    }

    #[test]
    fn unchanged_data_gives_an_identical_snapshot() {
        let (_directory, database) = file_database();
        add_phone(&database, "0722000001");
        assert_eq!(database.snapshot().unwrap(), database.snapshot().unwrap());
    }

    #[test]
    fn restore_refuses_anything_that_is_not_a_backup() {
        let (directory, database) = file_database();
        add_phone(&database, "0722000001");

        assert_eq!(
            database.restore(&[7u8; 8192]),
            Err(AppError::code("backup_invalid"))
        );

        let other = directory.path().join("other.db");
        Connection::open(&other).unwrap().execute("CREATE TABLE t (x)", []).unwrap();
        let other_contents = fs::read(&other).unwrap();
        assert_eq!(database.restore(&other_contents), Err(AppError::code("backup_invalid")));

        assert_eq!(phones(&database), ["0722000001"]);
    }

    #[test]
    fn restore_refuses_a_backup_from_a_newer_app() {
        let (directory, database) = file_database();
        add_phone(&database, "0722000001");

        let newer = directory.path().join("newer.db");
        database
            .with(|conn| {
                vacuum_into(conn, &newer)
            })
            .unwrap();
        Connection::open(&newer)
            .unwrap()
            .pragma_update(None, "user_version", MIGRATIONS.len() as u32 + 1)
            .unwrap();

        assert_eq!(
            database.restore(&fs::read(&newer).unwrap()),
            Err(AppError::code("backup_newer"))
        );
    }

    #[test]
    fn restoring_an_older_backup_upgrades_it() {
        let (directory, database) = file_database();
        let older = directory.path().join("older.db");
        let conn = Connection::open(&older).unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.execute("INSERT INTO clients (Phone) VALUES ('0722000001')", []).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        drop(conn);

        database.restore(&fs::read(&older).unwrap()).unwrap();

        assert_eq!(phones(&database), ["0722000001"]);
        database
            .with(|conn| {
                assert_eq!(schema_version(conn).unwrap() as usize, MIGRATIONS.len());
                let opted_out: i64 =
                    conn.query_row("SELECT SmsOptOut FROM clients", [], |row| row.get(0))?;
                assert_eq!(opted_out, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn an_empty_database_is_reported() {
        let (_directory, database) = file_database();
        assert!(database.is_empty().unwrap());
        add_phone(&database, "0722000001");
        assert!(!database.is_empty().unwrap());
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
