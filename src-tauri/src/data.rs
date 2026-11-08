//! Queries and business rules behind the Data page.
//!
//! Errors reach the frontend as short codes (see `errors` in `src/locales`).

use rusqlite::ffi::{SQLITE_CONSTRAINT_FOREIGNKEY, SQLITE_CONSTRAINT_UNIQUE};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

const PAGE_SIZE: i64 = 50;
const OPTION_LIMIT: i64 = 50;
const DUE_SOON_DAYS: i64 = 30;
const MAX_DURATION_MINUTES: i64 = 24 * 60;

const CAR_LABEL: &str = "c.Plate || ' · ' || c.Manufacturer || ' ' || c.Model";

/// Clamps to the end of the month, so 31 August + 6 months is 28 February.
const NEXT_REVISION: &str = "date(c.LastRevision, '+' || c.RevisionFrequency || ' months', 'floor')";

/// Cars whose only linked client is `?1`, which go away with that client.
const ORPHAN_CARS: &str = "SELECT l.CarID FROM carsclients l WHERE l.ClientID = ?1 AND NOT EXISTS
    (SELECT 1 FROM carsclients o WHERE o.CarID = l.CarID AND o.ClientID <> ?1)";

#[derive(Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AppError(String);

impl AppError {
    fn code(code: &str) -> Self {
        Self(code.to_string())
    }

    pub fn from_message(message: String) -> Self {
        Self(message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        match error.sqlite_error().map(|e| e.extended_code) {
            Some(SQLITE_CONSTRAINT_FOREIGNKEY) => Self::code("not_found"),
            _ => Self(error.to_string()),
        }
    }
}

type Result<T> = std::result::Result<T, AppError>;

/// Maps a violated UNIQUE constraint to a code naming the duplicated field.
fn duplicate_as(code: &'static str) -> impl Fn(rusqlite::Error) -> AppError {
    move |error| match error.sqlite_error().map(|e| e.extended_code) {
        Some(SQLITE_CONSTRAINT_UNIQUE) => AppError::code(code),
        _ => error.into(),
    }
}

#[derive(Serialize)]
pub struct Page<T> {
    rows: Vec<T>,
    total: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerOption {
    id: i64,
    label: String,
    linked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    client_id: i64,
    phone: String,
    cars: Vec<PickerOption>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Car {
    car_id: i64,
    plate: String,
    manufacturer: String,
    model: String,
    last_revision: Option<String>,
    revision_frequency: i64,
    next_revision: Option<String>,
    revision_state: String,
    clients: Vec<PickerOption>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Appointment {
    appointment_id: i64,
    client_id: i64,
    car_id: i64,
    time_date: String,
    is_done: bool,
    duration: i64,
    phone: String,
    car_label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFilter {
    search: String,
    page: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarFilter {
    search: String,
    frequency: Option<i64>,
    revision_state: Option<String>,
    page: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentFilter {
    search: String,
    is_done: Option<bool>,
    from: Option<String>,
    to: Option<String>,
    page: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    client_id: Option<i64>,
    phone: String,
    car_ids: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CarInput {
    car_id: Option<i64>,
    plate: String,
    manufacturer: String,
    model: String,
    last_revision: Option<String>,
    revision_frequency: i64,
    client_ids: Vec<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentInput {
    appointment_id: Option<i64>,
    client_id: i64,
    car_id: i64,
    time_date: String,
    is_done: bool,
    duration: i64,
}

/// Sent back when an appointment stops being done, so the user can correct
/// the car's LastRevision.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionPrompt {
    car_id: i64,
    plate: String,
    last_revision: Option<String>,
    suggested: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAppointmentResult {
    revision_prompt: Option<RevisionPrompt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAppointmentItem {
    time_date: String,
    plate: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    cars: Vec<String>,
    appointments: Vec<DeleteAppointmentItem>,
}

/// Collects WHERE conditions and their bound values.
#[derive(Default)]
struct Filter {
    conditions: Vec<String>,
    values: Vec<Value>,
}

impl Filter {
    /// Every word must match at least one condition, so "dacia b123" and a
    /// plate typed with spaces both work. Each condition holds one `?`.
    fn search(&mut self, text: &str, conditions: &[String]) {
        for word in text.split_whitespace() {
            let escaped = word.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            self.conditions.push(format!("({})", conditions.join(" OR ")));
            self.values
                .extend(conditions.iter().map(|_| Value::Text(format!("%{escaped}%"))));
        }
    }

    fn add(&mut self, condition: String, value: impl Into<Value>) {
        self.conditions.push(condition);
        self.values.push(value.into());
    }

    fn where_clause(&self) -> String {
        if self.conditions.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", self.conditions.join(" AND "))
        }
    }

    fn total(&self, conn: &Connection, from: &str) -> Result<i64> {
        let sql = format!("SELECT COUNT(*) FROM {from}{}", self.where_clause());
        Ok(conn.query_row(&sql, params_from_iter(self.values.iter()), |r| r.get(0))?)
    }

    fn rows<T>(
        &self,
        conn: &Connection,
        select: &str,
        order: &str,
        page: i64,
        map: impl FnMut(&Row) -> rusqlite::Result<T>,
    ) -> Result<Vec<T>> {
        let sql = format!(
            "{select}{} ORDER BY {order} LIMIT {PAGE_SIZE} OFFSET {}",
            self.where_clause(),
            page.max(0) * PAGE_SIZE
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(self.values.iter()), map)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

fn like(expression: &str) -> String {
    format!("{expression} LIKE ? ESCAPE '\\'")
}

fn revision_state_sql() -> String {
    format!(
        "CASE WHEN c.LastRevision IS NULL THEN 'unknown'
              WHEN {NEXT_REVISION} < date('now', 'localtime') THEN 'overdue'
              WHEN {NEXT_REVISION} <= date('now', 'localtime', '+{DUE_SOON_DAYS} days') THEN 'soon'
              ELSE 'ok' END"
    )
}

fn normalize_phone(phone: &str) -> Result<String> {
    let compact: String = phone
        .chars()
        .filter(|c| !c.is_whitespace() && !"-.()/".contains(*c))
        .collect();
    let national = if let Some(rest) = compact.strip_prefix("+40") {
        format!("0{rest}")
    } else if let Some(rest) = compact.strip_prefix("0040") {
        format!("0{rest}")
    } else {
        compact
    };
    let digits = national.strip_prefix('+').unwrap_or(&national);
    if (6..=15).contains(&digits.len()) && digits.chars().all(|c| c.is_ascii_digit()) {
        Ok(national)
    } else {
        Err(AppError::code("invalid_phone"))
    }
}

fn normalize_plate(plate: &str) -> Result<String> {
    let compact: String = plate
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .flat_map(char::to_uppercase)
        .collect();
    if compact.is_empty() {
        Err(AppError::code("required_fields"))
    } else {
        Ok(compact)
    }
}

/// SQLite returns a different string for impossible dates such as 31 February.
fn has_format(conn: &Connection, format: &str, value: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT strftime(?1, ?2) IS ?2", params![format, value], |r| r.get(0))?)
}

fn is_future_date(conn: &Connection, value: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT date(?1) > date('now', 'localtime')",
        params![value],
        |r| r.get(0),
    )?)
}

fn validate_last_revision(conn: &Connection, value: Option<&str>) -> Result<()> {
    let Some(value) = value else { return Ok(()) };
    if !has_format(conn, "%Y-%m-%d", value)? {
        return Err(AppError::code("invalid_date"));
    }
    if is_future_date(conn, value)? {
        return Err(AppError::code("revision_in_future"));
    }
    Ok(())
}

fn require_changed(changed: usize) -> Result<()> {
    if changed == 0 {
        Err(AppError::code("not_found"))
    } else {
        Ok(())
    }
}

fn linked_cars(conn: &Connection, client_id: i64) -> Result<Vec<PickerOption>> {
    let sql = format!(
        "SELECT c.CarID, {CAR_LABEL} FROM cars c
         JOIN carsclients l ON l.CarID = c.CarID WHERE l.ClientID = ?1 ORDER BY c.Plate"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([client_id], |r| {
        Ok(PickerOption { id: r.get(0)?, label: r.get(1)?, linked: true })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn linked_clients(conn: &Connection, car_id: i64) -> Result<Vec<PickerOption>> {
    let mut statement = conn.prepare(
        "SELECT c.ClientID, c.Phone FROM clients c
         JOIN carsclients l ON l.ClientID = c.ClientID WHERE l.CarID = ?1 ORDER BY c.Phone",
    )?;
    let rows = statement.query_map([car_id], |r| {
        Ok(PickerOption { id: r.get(0)?, label: r.get(1)?, linked: true })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn list_clients(conn: &Connection, input: ClientFilter) -> Result<Page<Client>> {
    let mut filter = Filter::default();
    filter.search(
        &input.search,
        &[
            like("c.Phone"),
            format!(
                "EXISTS (SELECT 1 FROM carsclients l JOIN cars car ON car.CarID = l.CarID
                 WHERE l.ClientID = c.ClientID AND {})",
                like("car.Plate")
            ),
        ],
    );
    let found = filter.rows(
        conn,
        "SELECT c.ClientID, c.Phone FROM clients c",
        "c.Phone",
        input.page,
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )?;
    let rows = found
        .into_iter()
        .map(|(client_id, phone)| {
            Ok(Client { client_id, phone, cars: linked_cars(conn, client_id)? })
        })
        .collect::<Result<_>>()?;
    Ok(Page { rows, total: filter.total(conn, "clients c")? })
}

pub fn list_cars(conn: &Connection, input: CarFilter) -> Result<Page<Car>> {
    let state = revision_state_sql();
    let mut filter = Filter::default();
    filter.search(
        &input.search,
        &[
            like("c.Plate"),
            like("c.Manufacturer"),
            like("c.Model"),
            format!(
                "EXISTS (SELECT 1 FROM carsclients l JOIN clients cl ON cl.ClientID = l.ClientID
                 WHERE l.CarID = c.CarID AND {})",
                like("cl.Phone")
            ),
        ],
    );
    if let Some(frequency) = input.frequency {
        filter.add("c.RevisionFrequency = ?".into(), frequency);
    }
    if let Some(revision_state) = input.revision_state {
        filter.add(format!("{state} = ?"), revision_state);
    }

    let select = format!(
        "SELECT c.CarID, c.Plate, c.Manufacturer, c.Model, c.LastRevision, c.RevisionFrequency,
                {NEXT_REVISION}, {state} FROM cars c"
    );
    let mut rows = filter.rows(conn, &select, "c.Plate", input.page, |r| {
        Ok(Car {
            car_id: r.get(0)?,
            plate: r.get(1)?,
            manufacturer: r.get(2)?,
            model: r.get(3)?,
            last_revision: r.get(4)?,
            revision_frequency: r.get(5)?,
            next_revision: r.get(6)?,
            revision_state: r.get(7)?,
            clients: Vec::new(),
        })
    })?;
    for car in &mut rows {
        car.clients = linked_clients(conn, car.car_id)?;
    }
    Ok(Page { rows, total: filter.total(conn, "cars c")? })
}

const APPOINTMENT_FROM: &str = "appointments a
    JOIN clients cl ON cl.ClientID = a.ClientID
    JOIN cars c ON c.CarID = a.CarID";

fn appointment_select() -> String {
    format!(
        "SELECT a.AppointmentID, a.ClientID, a.CarID, a.TimeDate, a.IsDone, a.Duration,
                cl.Phone, {CAR_LABEL} FROM {APPOINTMENT_FROM}"
    )
}

fn appointment_from_row(r: &Row) -> rusqlite::Result<Appointment> {
    Ok(Appointment {
        appointment_id: r.get(0)?,
        client_id: r.get(1)?,
        car_id: r.get(2)?,
        time_date: r.get(3)?,
        is_done: r.get(4)?,
        duration: r.get(5)?,
        phone: r.get(6)?,
        car_label: r.get(7)?,
    })
}

/// Every appointment starting on a day from `from` to `to`, both included.
pub fn appointments_between(conn: &Connection, from: &str, to: &str) -> Result<Vec<Appointment>> {
    let sql = format!(
        "{} WHERE substr(a.TimeDate, 1, 10) BETWEEN ?1 AND ?2 ORDER BY a.TimeDate",
        appointment_select()
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![from, to], appointment_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn list_appointments(conn: &Connection, input: AppointmentFilter) -> Result<Page<Appointment>> {
    let mut filter = Filter::default();
    filter.search(
        &input.search,
        &[like("cl.Phone"), like("c.Plate"), like("c.Manufacturer"), like("c.Model")],
    );
    if let Some(is_done) = input.is_done {
        filter.add("a.IsDone = ?".into(), is_done);
    }
    if let Some(from) = input.from {
        filter.add("substr(a.TimeDate, 1, 10) >= ?".into(), from);
    }
    if let Some(to) = input.to {
        filter.add("substr(a.TimeDate, 1, 10) <= ?".into(), to);
    }

    let rows = filter.rows(conn, &appointment_select(), "a.TimeDate DESC", input.page, appointment_from_row)?;
    Ok(Page { rows, total: filter.total(conn, APPOINTMENT_FROM)? })
}

/// Clients for a picker. Those linked to `car_id` come first.
pub fn client_options(conn: &Connection, search: &str, car_id: Option<i64>) -> Result<Vec<PickerOption>> {
    let mut filter = Filter::default();
    filter.search(search, &[like("c.Phone")]);
    options(
        conn,
        filter,
        "SELECT c.ClientID, c.Phone, EXISTS
            (SELECT 1 FROM carsclients l WHERE l.ClientID = c.ClientID AND l.CarID = ?) FROM clients c",
        "c.Phone",
        car_id,
    )
}

/// Cars for a picker. Those linked to `client_id` come first.
pub fn car_options(conn: &Connection, search: &str, client_id: Option<i64>) -> Result<Vec<PickerOption>> {
    let mut filter = Filter::default();
    filter.search(search, &[like("c.Plate"), like("c.Manufacturer"), like("c.Model")]);
    let select = format!(
        "SELECT c.CarID, {CAR_LABEL}, EXISTS
            (SELECT 1 FROM carsclients l WHERE l.CarID = c.CarID AND l.ClientID = ?) FROM cars c"
    );
    options(conn, filter, &select, "c.Plate", client_id)
}

fn options(
    conn: &Connection,
    filter: Filter,
    select: &str,
    order: &str,
    linked_to: Option<i64>,
) -> Result<Vec<PickerOption>> {
    let sql = format!("{select}{} ORDER BY 3 DESC, {order} LIMIT {OPTION_LIMIT}", filter.where_clause());
    let mut values = vec![Value::from(linked_to)];
    values.extend(filter.values);
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |r| {
        Ok(PickerOption { id: r.get(0)?, label: r.get(1)?, linked: r.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn save_client(conn: &mut Connection, input: ClientInput) -> Result<PickerOption> {
    let phone = normalize_phone(&input.phone)?;
    let tx = conn.transaction()?;
    let client_id = match input.client_id {
        Some(id) => {
            let changed = tx
                .execute("UPDATE clients SET Phone = ?1 WHERE ClientID = ?2", params![phone, id])
                .map_err(duplicate_as("phone_exists"))?;
            require_changed(changed)?;
            id
        }
        None => {
            tx.execute("INSERT INTO clients (Phone) VALUES (?1)", params![phone])
                .map_err(duplicate_as("phone_exists"))?;
            tx.last_insert_rowid()
        }
    };
    tx.execute("DELETE FROM carsclients WHERE ClientID = ?1", [client_id])?;
    for car_id in input.car_ids {
        tx.execute(
            "INSERT OR IGNORE INTO carsclients (CarID, ClientID) VALUES (?1, ?2)",
            params![car_id, client_id],
        )?;
    }
    tx.commit()?;
    Ok(PickerOption { id: client_id, label: phone, linked: false })
}

pub fn save_car(conn: &mut Connection, input: CarInput) -> Result<PickerOption> {
    let plate = normalize_plate(&input.plate)?;
    let manufacturer = input.manufacturer.trim();
    let model = input.model.trim();
    if manufacturer.is_empty() || model.is_empty() {
        return Err(AppError::code("required_fields"));
    }
    if ![6, 12, 24].contains(&input.revision_frequency) {
        return Err(AppError::code("required_fields"));
    }
    validate_last_revision(conn, input.last_revision.as_deref())?;

    let tx = conn.transaction()?;
    let car_id = match input.car_id {
        Some(id) => {
            let changed = tx
                .execute(
                    "UPDATE cars SET Plate = ?1, Manufacturer = ?2, Model = ?3, LastRevision = ?4,
                     RevisionFrequency = ?5 WHERE CarID = ?6",
                    params![plate, manufacturer, model, input.last_revision, input.revision_frequency, id],
                )
                .map_err(duplicate_as("plate_exists"))?;
            require_changed(changed)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![plate, manufacturer, model, input.last_revision, input.revision_frequency],
            )
            .map_err(duplicate_as("plate_exists"))?;
            tx.last_insert_rowid()
        }
    };
    tx.execute("DELETE FROM carsclients WHERE CarID = ?1", [car_id])?;
    for client_id in input.client_ids {
        tx.execute(
            "INSERT OR IGNORE INTO carsclients (CarID, ClientID) VALUES (?1, ?2)",
            params![car_id, client_id],
        )?;
    }
    tx.commit()?;
    Ok(PickerOption {
        id: car_id,
        label: format!("{plate} · {manufacturer} {model}"),
        linked: false,
    })
}

pub fn save_appointment(conn: &mut Connection, input: AppointmentInput) -> Result<SaveAppointmentResult> {
    if !has_format(conn, "%Y-%m-%dT%H:%M", &input.time_date)? {
        return Err(AppError::code("invalid_date"));
    }
    if !(1..=MAX_DURATION_MINUTES).contains(&input.duration) {
        return Err(AppError::code("invalid_duration"));
    }
    let date = &input.time_date[..10];
    if input.is_done && is_future_date(conn, date)? {
        return Err(AppError::code("done_in_future"));
    }

    let tx = conn.transaction()?;
    let previous: Option<(bool, i64)> = match input.appointment_id {
        Some(id) => Some(
            tx.query_row(
                "SELECT IsDone, CarID FROM appointments WHERE AppointmentID = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::code("not_found"))?,
        ),
        None => None,
    };

    match input.appointment_id {
        Some(id) => {
            tx.execute(
                "UPDATE appointments SET ClientID = ?1, CarID = ?2, TimeDate = ?3, IsDone = ?4,
                 Duration = ?5 WHERE AppointmentID = ?6",
                params![input.client_id, input.car_id, input.time_date, input.is_done, input.duration, id],
            )?;
        }
        None => {
            tx.execute(
                "INSERT INTO appointments (ClientID, CarID, TimeDate, IsDone, Duration)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![input.client_id, input.car_id, input.time_date, input.is_done, input.duration],
            )?;
        }
    }

    tx.execute(
        "INSERT OR IGNORE INTO carsclients (CarID, ClientID) VALUES (?1, ?2)",
        params![input.car_id, input.client_id],
    )?;
    if input.is_done {
        tx.execute(
            "UPDATE cars SET LastRevision = ?1
             WHERE CarID = ?2 AND (LastRevision IS NULL OR LastRevision < ?1)",
            params![date, input.car_id],
        )?;
    }

    let revision_prompt = match previous {
        Some((true, car_id)) if !input.is_done => Some(revision_prompt(&tx, car_id)?),
        _ => None,
    };
    tx.commit()?;
    Ok(SaveAppointmentResult { revision_prompt })
}

fn revision_prompt(conn: &Connection, car_id: i64) -> Result<RevisionPrompt> {
    Ok(conn.query_row(
        "SELECT c.Plate, c.LastRevision,
                (SELECT MAX(substr(a.TimeDate, 1, 10)) FROM appointments a
                 WHERE a.CarID = c.CarID AND a.IsDone = 1)
         FROM cars c WHERE c.CarID = ?1",
        [car_id],
        |r| {
            Ok(RevisionPrompt {
                car_id,
                plate: r.get(0)?,
                last_revision: r.get(1)?,
                suggested: r.get(2)?,
            })
        },
    )?)
}

pub fn set_last_revision(conn: &Connection, car_id: i64, value: Option<String>) -> Result<()> {
    validate_last_revision(conn, value.as_deref())?;
    require_changed(conn.execute(
        "UPDATE cars SET LastRevision = ?1 WHERE CarID = ?2",
        params![value, car_id],
    )?)
}

fn preview(conn: &Connection, cars_sql: &str, appointments_where: &str, id: i64) -> Result<DeletePreview> {
    let mut statement = conn.prepare(cars_sql)?;
    let cars = statement
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut statement = conn.prepare(&format!(
        "SELECT a.TimeDate, c.Plate FROM appointments a JOIN cars c ON c.CarID = a.CarID
         WHERE {appointments_where} ORDER BY a.TimeDate DESC"
    ))?;
    let appointments = statement
        .query_map([id], |r| Ok(DeleteAppointmentItem { time_date: r.get(0)?, plate: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(DeletePreview { cars, appointments })
}

pub fn preview_delete_client(conn: &Connection, client_id: i64) -> Result<DeletePreview> {
    let cars = format!("SELECT {CAR_LABEL} FROM cars c WHERE c.CarID IN ({ORPHAN_CARS}) ORDER BY c.Plate");
    let appointments = format!("a.ClientID = ?1 OR a.CarID IN ({ORPHAN_CARS})");
    preview(conn, &cars, &appointments, client_id)
}

pub fn preview_delete_car(conn: &Connection, car_id: i64) -> Result<DeletePreview> {
    let cars = format!("SELECT {CAR_LABEL} FROM cars c WHERE c.CarID = ?1");
    preview(conn, &cars, "a.CarID = ?1", car_id)
}

pub fn delete_client(conn: &mut Connection, client_id: i64) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(&format!("DELETE FROM cars WHERE CarID IN ({ORPHAN_CARS})"), [client_id])?;
    require_changed(tx.execute("DELETE FROM clients WHERE ClientID = ?1", [client_id])?)?;
    tx.commit()?;
    Ok(())
}

pub fn delete_car(conn: &Connection, car_id: i64) -> Result<()> {
    require_changed(conn.execute("DELETE FROM cars WHERE CarID = ?1", [car_id])?)
}

pub fn delete_appointment(conn: &Connection, appointment_id: i64) -> Result<()> {
    require_changed(conn.execute("DELETE FROM appointments WHERE AppointmentID = ?1", [appointment_id])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    fn code(code: &str) -> AppError {
        AppError::code(code)
    }

    fn client(conn: &mut Connection, phone: &str, car_ids: Vec<i64>) -> i64 {
        save_client(conn, ClientInput { client_id: None, phone: phone.into(), car_ids })
            .unwrap()
            .id
    }

    fn car_input(plate: &str, last_revision: Option<&str>, months: i64) -> CarInput {
        CarInput {
            car_id: None,
            plate: plate.into(),
            manufacturer: "Dacia".into(),
            model: "Logan".into(),
            last_revision: last_revision.map(str::to_string),
            revision_frequency: months,
            client_ids: vec![],
        }
    }

    fn car(conn: &mut Connection, plate: &str) -> i64 {
        save_car(conn, car_input(plate, None, 12)).unwrap().id
    }

    fn appointment(client_id: i64, car_id: i64, time_date: &str, is_done: bool) -> AppointmentInput {
        AppointmentInput {
            appointment_id: None,
            client_id,
            car_id,
            time_date: time_date.into(),
            is_done,
            duration: 30,
        }
    }

    fn scalar(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn last_revision(conn: &Connection, car_id: i64) -> Option<String> {
        conn.query_row("SELECT LastRevision FROM cars WHERE CarID = ?1", [car_id], |r| r.get(0))
            .unwrap()
    }

    fn cars_page(conn: &Connection, search: &str, state: Option<&str>) -> Page<Car> {
        list_cars(
            conn,
            CarFilter {
                search: search.into(),
                frequency: None,
                revision_state: state.map(str::to_string),
                page: 0,
            },
        )
        .unwrap()
    }

    #[test]
    fn phone_variants_are_the_same_client() {
        let mut conn = test_connection();
        client(&mut conn, "0722 123-456", vec![]);
        for duplicate in ["0722123456", "+40722123456", "0040 722 123 456"] {
            let input = ClientInput { client_id: None, phone: duplicate.into(), car_ids: vec![] };
            assert_eq!(save_client(&mut conn, input).err(), Some(code("phone_exists")));
        }
    }

    #[test]
    fn rejects_invalid_phone() {
        let mut conn = test_connection();
        for phone in ["", "abc", "12"] {
            let input = ClientInput { client_id: None, phone: phone.into(), car_ids: vec![] };
            assert_eq!(save_client(&mut conn, input).err(), Some(code("invalid_phone")));
        }
    }

    #[test]
    fn plate_is_normalized_before_saving() {
        let mut conn = test_connection();
        car(&mut conn, "b-123 abc");
        assert_eq!(cars_page(&conn, "B123ABC", None).total, 1);
        assert_eq!(
            save_car(&mut conn, car_input("B 123 ABC", None, 12)).err(),
            Some(code("plate_exists"))
        );
    }

    #[test]
    fn save_client_replaces_its_links() {
        let mut conn = test_connection();
        let first = car(&mut conn, "B1AAA");
        let second = car(&mut conn, "B2AAA");
        let id = client(&mut conn, "0722000000", vec![first]);
        save_client(
            &mut conn,
            ClientInput { client_id: Some(id), phone: "0722000000".into(), car_ids: vec![second] },
        )
        .unwrap();
        assert_eq!(scalar(&conn, "SELECT CarID FROM carsclients"), second);
    }

    #[test]
    fn search_requires_every_word_and_treats_wildcards_literally() {
        let mut conn = test_connection();
        let id = car(&mut conn, "B123ABC");
        client(&mut conn, "0722000000", vec![id]);
        assert_eq!(cars_page(&conn, "dacia b123", None).total, 1);
        assert_eq!(cars_page(&conn, "B 123 ABC", None).total, 1);
        assert_eq!(cars_page(&conn, "0722", None).total, 1);
        assert_eq!(cars_page(&conn, "dacia ford", None).total, 0);
        assert_eq!(cars_page(&conn, "%", None).total, 0);
    }

    #[test]
    fn next_revision_clamps_to_month_end() {
        let mut conn = test_connection();
        save_car(&mut conn, car_input("B1AAA", Some("2023-08-31"), 6)).unwrap();
        let page = cars_page(&conn, "", None);
        assert_eq!(page.rows[0].next_revision.as_deref(), Some("2024-02-29"));
    }

    #[test]
    fn revision_state_can_be_filtered() {
        let mut conn = test_connection();
        save_car(&mut conn, car_input("B1AAA", Some("2020-01-01"), 6)).unwrap();
        car(&mut conn, "B2AAA");
        assert_eq!(cars_page(&conn, "", Some("overdue")).rows[0].plate, "B1AAA");
        assert_eq!(cars_page(&conn, "", Some("unknown")).rows[0].plate, "B2AAA");
    }

    #[test]
    fn appointment_links_client_and_car() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        save_appointment(&mut conn, appointment(client_id, car_id, "2030-01-10T09:30", false)).unwrap();
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM carsclients"), 1);
    }

    #[test]
    fn appointment_needs_existing_records_and_valid_values() {
        let mut conn = test_connection();
        assert_eq!(
            save_appointment(&mut conn, appointment(1, 1, "2030-01-10T09:30", false)).err(),
            Some(code("not_found"))
        );
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        assert_eq!(
            save_appointment(&mut conn, appointment(client_id, car_id, "2030-02-31T09:30", false)).err(),
            Some(code("invalid_date"))
        );
        let mut zero = appointment(client_id, car_id, "2030-01-10T09:30", false);
        zero.duration = 0;
        assert_eq!(save_appointment(&mut conn, zero).err(), Some(code("invalid_duration")));
    }

    #[test]
    fn cannot_mark_future_appointment_done() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        assert_eq!(
            save_appointment(&mut conn, appointment(client_id, car_id, "2999-01-10T09:30", true)).err(),
            Some(code("done_in_future"))
        );
        assert_eq!(last_revision(&conn, car_id), None);
    }

    #[test]
    fn done_appointment_only_moves_last_revision_forward() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        save_appointment(&mut conn, appointment(client_id, car_id, "2024-05-01T09:30", true)).unwrap();
        assert_eq!(last_revision(&conn, car_id).as_deref(), Some("2024-05-01"));
        save_appointment(&mut conn, appointment(client_id, car_id, "2023-05-01T09:30", true)).unwrap();
        assert_eq!(last_revision(&conn, car_id).as_deref(), Some("2024-05-01"));
    }

    #[test]
    fn unticking_done_offers_a_correction() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        save_appointment(&mut conn, appointment(client_id, car_id, "2023-05-01T09:30", true)).unwrap();
        save_appointment(&mut conn, appointment(client_id, car_id, "2024-05-01T09:30", true)).unwrap();

        let mut untick = appointment(client_id, car_id, "2024-05-01T09:30", false);
        untick.appointment_id = Some(2);
        let result = save_appointment(&mut conn, untick).unwrap();

        assert_eq!(
            result.revision_prompt,
            Some(RevisionPrompt {
                car_id,
                plate: "B1AAA".into(),
                last_revision: Some("2024-05-01".into()),
                suggested: Some("2023-05-01".into()),
            })
        );
    }

    #[test]
    fn deleting_client_keeps_shared_cars() {
        let mut conn = test_connection();
        let own = car(&mut conn, "B1AAA");
        let shared = car(&mut conn, "B2AAA");
        let leaving = client(&mut conn, "0722000000", vec![own, shared]);
        let other = client(&mut conn, "0733000000", vec![shared]);
        save_appointment(&mut conn, appointment(leaving, own, "2030-01-10T09:30", false)).unwrap();
        save_appointment(&mut conn, appointment(leaving, shared, "2030-01-11T09:30", false)).unwrap();
        save_appointment(&mut conn, appointment(other, shared, "2030-01-12T09:30", false)).unwrap();

        let preview = preview_delete_client(&conn, leaving).unwrap();
        assert_eq!(preview.cars, vec!["B1AAA · Dacia Logan".to_string()]);
        assert_eq!(preview.appointments.len(), 2);

        delete_client(&mut conn, leaving).unwrap();

        assert_eq!(scalar(&conn, "SELECT CarID FROM cars"), shared);
        assert_eq!(scalar(&conn, "SELECT ClientID FROM clients"), other);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM carsclients"), 1);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM appointments"), 1);
    }

    #[test]
    fn deleting_car_keeps_clients() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![car_id]);
        save_appointment(&mut conn, appointment(client_id, car_id, "2030-01-10T09:30", false)).unwrap();

        assert_eq!(preview_delete_car(&conn, car_id).unwrap().appointments.len(), 1);
        delete_car(&conn, car_id).unwrap();

        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM appointments"), 0);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM clients"), 1);
    }

    #[test]
    fn deleting_missing_records_reports_not_found() {
        let mut conn = test_connection();
        assert_eq!(delete_client(&mut conn, 99).err(), Some(code("not_found")));
        assert_eq!(delete_car(&conn, 99).err(), Some(code("not_found")));
        assert_eq!(delete_appointment(&conn, 99).err(), Some(code("not_found")));
    }

    #[test]
    fn appointment_filters_apply() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        save_appointment(&mut conn, appointment(client_id, car_id, "2024-05-01T09:30", true)).unwrap();
        save_appointment(&mut conn, appointment(client_id, car_id, "2030-01-10T09:30", false)).unwrap();

        let total = |is_done, from: Option<&str>, to: Option<&str>| {
            list_appointments(
                &conn,
                AppointmentFilter {
                    search: "b1aaa".into(),
                    is_done,
                    from: from.map(str::to_string),
                    to: to.map(str::to_string),
                    page: 0,
                },
            )
            .unwrap()
            .total
        };
        assert_eq!(total(None, None, None), 2);
        assert_eq!(total(Some(true), None, None), 1);
        assert_eq!(total(None, Some("2024-05-01"), Some("2024-05-01")), 1);
    }

    #[test]
    fn appointments_between_includes_both_end_days_in_time_order() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![]);
        for time_date in [
            "2030-01-13T23:30",
            "2030-01-14T08:00",
            "2030-01-20T23:30",
            "2030-01-14T07:00",
            "2030-01-21T00:00",
        ] {
            save_appointment(&mut conn, appointment(client_id, car_id, time_date, false)).unwrap();
        }

        let found: Vec<String> = appointments_between(&conn, "2030-01-14", "2030-01-20")
            .unwrap()
            .into_iter()
            .map(|a| a.time_date)
            .collect();

        assert_eq!(found, ["2030-01-14T07:00", "2030-01-14T08:00", "2030-01-20T23:30"]);
    }

    #[test]
    fn options_list_linked_records_first() {
        let mut conn = test_connection();
        car(&mut conn, "A1AAA");
        let linked = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![linked]);
        let options = car_options(&conn, "", Some(client_id)).unwrap();
        assert_eq!(options[0].id, linked);
        assert!(options[0].linked);
        assert!(!options[1].linked);
    }
}
