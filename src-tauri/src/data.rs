//! Queries and business rules behind the Data page.
//!
//! Errors reach the frontend as short codes (see `errors` in `src/locales`).

use rusqlite::ffi::{SQLITE_CONSTRAINT_FOREIGNKEY, SQLITE_CONSTRAINT_UNIQUE};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub(crate) const PAGE_SIZE: i64 = 50;
const OPTION_LIMIT: i64 = 50;
const DUE_SOON_DAYS: i64 = 30;

const CAR_LABEL: &str = "c.Plate || ' · ' || c.Manufacturer || ' ' || c.Model";

/// Clamps to the end of the month, so 31 August + 6 months is 28 February.
pub(crate) const NEXT_REVISION: &str = "date(c.LastRevision, '+' || c.RevisionFrequency || ' months', 'floor')";

/// Cars whose only linked client is `?1`, which go away with that client.
const ORPHAN_CARS: &str = "SELECT l.CarID FROM carsclients l WHERE l.ClientID = ?1 AND NOT EXISTS
    (SELECT 1 FROM carsclients o WHERE o.CarID = l.CarID AND o.ClientID <> ?1)";

#[derive(Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct AppError(String);

impl AppError {
    pub(crate) fn code(code: &str) -> Self {
        Self(code.to_string())
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
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
    pub(crate) rows: Vec<T>,
    pub(crate) total: i64,
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
    sms_opt_out: bool,
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
    /// "Other information", empty when not filled in.
    notes: String,
    next_revision: Option<String>,
    revision_state: String,
    /// The client who brought the car to its last inspection, when known.
    inspected_by: Option<i64>,
    /// When the car was added to the app.
    created_at: Option<String>,
    /// When the car was last added or edited.
    updated_at: Option<String>,
    /// The client agreed to be asked for feedback after the inspection.
    feedback: bool,
    clients: Vec<PickerOption>,
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
    /// Last inspection between these days, both included.
    #[serde(default)]
    revision_from: Option<String>,
    #[serde(default)]
    revision_to: Option<String>,
    /// "edited" (most recently added or edited first, the default), "plate", or "newest" /
    /// "oldest" last inspection first.
    #[serde(default)]
    sort: Option<String>,
    /// Only plates starting with this, as typed in the car form (spaces and dashes ignored).
    #[serde(default)]
    plate_prefix: Option<String>,
    page: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInput {
    client_id: Option<i64>,
    phone: String,
    sms_opt_out: bool,
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
    #[serde(default)]
    notes: String,
    #[serde(default)]
    feedback: bool,
    client_ids: Vec<i64>,
    /// Who brought the car to the inspection on `last_revision`.
    #[serde(default)]
    inspected_by: Option<i64>,
    /// Phones typed in the car form that are not clients yet. Each becomes a client linked
    /// to the car, or the existing client when the number is already known.
    #[serde(default)]
    new_phones: Vec<String>,
    /// Set instead of `inspected_by` when the car was brought by one of `new_phones`.
    #[serde(default)]
    inspected_by_phone: Option<String>,
}

/// One recorded inspection of a car.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionEntry {
    date: String,
    /// Who brought the car, when known.
    phone: Option<String>,
}

/// One message sent (or tried) about a car.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarMessage {
    sent_at: String,
    kind: String,
    channel: String,
    status: String,
    phone: String,
}

/// Everything recorded over time for one car, for its details window.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarHistory {
    inspections: Vec<InspectionEntry>,
    messages: Vec<CarMessage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    cars: Vec<String>,
    inspections: i64,
    messages: i64,
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

pub(crate) fn revision_state_sql() -> String {
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

/// A ten-digit Romanian number as people write it, "0722 123 456"; others as stored.
pub(crate) fn display_phone(phone: &str) -> String {
    if phone.len() == 10 && phone.starts_with('0') && phone.bytes().all(|b| b.is_ascii_digit()) {
        format!("{} {} {}", &phone[..4], &phone[4..7], &phone[7..])
    } else {
        phone.to_string()
    }
}

/// Several numbers joined with ", ", each shown as `display_phone` does.
pub(crate) fn display_phones(phones: &str) -> String {
    phones.split(", ").map(display_phone).collect::<Vec<_>>().join(", ")
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
pub(crate) fn has_format(conn: &Connection, format: &str, value: &str) -> Result<bool> {
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
        "SELECT c.ClientID, c.Phone, c.SmsOptOut FROM clients c",
        "c.Phone",
        input.page,
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, bool>(2)?)),
    )?;
    let rows = found
        .into_iter()
        .map(|(client_id, phone, sms_opt_out)| {
            Ok(Client { client_id, phone, sms_opt_out, cars: linked_cars(conn, client_id)? })
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
            like("c.Notes"),
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
    if let Some(from) = input.revision_from {
        filter.add("c.LastRevision >= ?".into(), from);
    }
    if let Some(to) = input.revision_to {
        filter.add("c.LastRevision <= ?".into(), to);
    }
    if let Some(prefix) = input.plate_prefix {
        let prefix: String =
            prefix.chars().filter(char::is_ascii_alphanumeric).flat_map(char::to_uppercase).collect();
        filter.add("c.Plate LIKE ? || '%'".into(), prefix);
    }
    // Cars with no known date always come last.
    let order = match input.sort.as_deref() {
        Some("newest") => "c.LastRevision IS NULL, c.LastRevision DESC, c.Plate",
        Some("oldest") => "c.LastRevision IS NULL, c.LastRevision ASC, c.Plate",
        Some("plate") => "c.Plate",
        _ => "c.UpdatedAt IS NULL, c.UpdatedAt DESC, c.CarID DESC",
    };

    let select = format!(
        "SELECT c.CarID, c.Plate, c.Manufacturer, c.Model, c.LastRevision, c.RevisionFrequency,
                {NEXT_REVISION}, {state},
                (SELECT i.ClientID FROM inspections i WHERE i.CarID = c.CarID AND i.Date = c.LastRevision),
                c.Notes, c.CreatedAt, c.Feedback, c.UpdatedAt
         FROM cars c"
    );
    let mut rows = filter.rows(conn, &select, order, input.page, |r| {
        Ok(Car {
            car_id: r.get(0)?,
            plate: r.get(1)?,
            manufacturer: r.get(2)?,
            model: r.get(3)?,
            last_revision: r.get(4)?,
            revision_frequency: r.get(5)?,
            next_revision: r.get(6)?,
            revision_state: r.get(7)?,
            inspected_by: r.get(8)?,
            notes: r.get(9)?,
            created_at: r.get(10)?,
            feedback: r.get(11)?,
            updated_at: r.get(12)?,
            clients: Vec::new(),
        })
    })?;
    for car in &mut rows {
        car.clients = linked_clients(conn, car.car_id)?;
    }
    Ok(Page { rows, total: filter.total(conn, "cars c")? })
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
                .execute(
                    "UPDATE clients SET Phone = ?1, SmsOptOut = ?2 WHERE ClientID = ?3",
                    params![phone, input.sms_opt_out, id],
                )
                .map_err(duplicate_as("phone_exists"))?;
            require_changed(changed)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO clients (Phone, SmsOptOut) VALUES (?1, ?2)",
                params![phone, input.sms_opt_out],
            )
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
    // The model is optional; an unknown one is stored as "-".
    let model = match input.model.trim() {
        "" => "-",
        model => model,
    };
    if manufacturer.is_empty() {
        return Err(AppError::code("required_fields"));
    }
    let notes = input.notes.trim();
    if ![6, 12, 24, 36].contains(&input.revision_frequency) {
        return Err(AppError::code("required_fields"));
    }
    validate_last_revision(conn, input.last_revision.as_deref())?;
    let new_phones = input
        .new_phones
        .iter()
        .map(|phone| normalize_phone(phone))
        .collect::<Result<Vec<_>>>()?;
    let inspected_by_phone = input.inspected_by_phone.as_deref().map(normalize_phone).transpose()?;

    let tx = conn.transaction()?;
    let mut client_ids = input.client_ids.clone();
    for phone in &new_phones {
        client_ids.push(client_by_phone(&tx, phone)?);
    }
    let inspected_by = match &inspected_by_phone {
        Some(phone) => Some(client_by_phone(&tx, phone)?),
        None => input.inspected_by,
    };
    let previous: Option<String> = match input.car_id {
        Some(id) => tx
            .query_row("SELECT LastRevision FROM cars WHERE CarID = ?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::code("not_found"))?,
        None => None,
    };
    let car_id = match input.car_id {
        Some(id) => {
            let changed = tx
                .execute(
                    "UPDATE cars SET Plate = ?1, Manufacturer = ?2, Model = ?3, LastRevision = ?4,
                     RevisionFrequency = ?5, Notes = ?6, Feedback = ?8,
                     UpdatedAt = strftime('%Y-%m-%dT%H:%M:%f', 'now', 'localtime') WHERE CarID = ?7",
                    params![
                        plate,
                        manufacturer,
                        model,
                        input.last_revision,
                        input.revision_frequency,
                        notes,
                        id,
                        input.feedback
                    ],
                )
                .map_err(duplicate_as("plate_exists"))?;
            require_changed(changed)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency, Notes,
                                   Feedback, CreatedAt, UpdatedAt)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'),
                         strftime('%Y-%m-%dT%H:%M:%f', 'now', 'localtime'))",
                params![
                    plate,
                    manufacturer,
                    model,
                    input.last_revision,
                    input.revision_frequency,
                    notes,
                    input.feedback
                ],
            )
            .map_err(duplicate_as("plate_exists"))?;
            tx.last_insert_rowid()
        }
    };
    tx.execute("DELETE FROM carsclients WHERE CarID = ?1", [car_id])?;
    for client_id in client_ids.iter().chain(&inspected_by) {
        tx.execute(
            "INSERT OR IGNORE INTO carsclients (CarID, ClientID) VALUES (?1, ?2)",
            params![car_id, client_id],
        )?;
    }
    record_inspection(
        &tx,
        car_id,
        previous.as_deref(),
        input.last_revision.as_deref(),
        inspected_by,
    )?;
    tx.commit()?;
    Ok(PickerOption {
        id: car_id,
        label: format!("{plate} · {manufacturer} {model}"),
        linked: false,
    })
}

/// The car's inspections and messages, newest first.
pub fn car_history(conn: &Connection, car_id: i64) -> Result<CarHistory> {
    let mut statement = conn.prepare(
        "SELECT i.Date, cl.Phone FROM inspections i
         LEFT JOIN clients cl ON cl.ClientID = i.ClientID
         WHERE i.CarID = ?1 ORDER BY i.Date DESC",
    )?;
    let inspections = statement
        .query_map([car_id], |r| Ok(InspectionEntry { date: r.get(0)?, phone: r.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut statement = conn.prepare(
        "SELECT m.SentAt, m.Type, m.Channel, m.Status, cl.Phone FROM messages m
         JOIN clients cl ON cl.ClientID = m.ClientID
         WHERE m.CarID = ?1 ORDER BY m.SentAt DESC, m.MessageID DESC",
    )?;
    let messages = statement
        .query_map([car_id], |r| {
            Ok(CarMessage {
                sent_at: r.get(0)?,
                kind: r.get(1)?,
                channel: r.get(2)?,
                status: r.get(3)?,
                phone: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(CarHistory { inspections, messages })
}

/// The client with this (normalized) phone, created if there is none.
fn client_by_phone(conn: &Connection, phone: &str) -> Result<i64> {
    conn.execute("INSERT OR IGNORE INTO clients (Phone) VALUES (?1)", [phone])?;
    Ok(conn.query_row("SELECT ClientID FROM clients WHERE Phone = ?1", [phone], |r| r.get(0))?)
}

/// Keeps the visit history in step with the car's last inspection date. A later date is a
/// new visit. The same date only updates who brought the car. An earlier or cleared date
/// corrects the latest visit instead of adding one.
fn record_inspection(
    conn: &Connection,
    car_id: i64,
    previous: Option<&str>,
    current: Option<&str>,
    client_id: Option<i64>,
) -> Result<()> {
    if let Some(previous) = previous
        && current.is_none_or(|current| current < previous)
    {
        conn.execute(
            "DELETE FROM inspections WHERE CarID = ?1 AND Date = ?2",
            params![car_id, previous],
        )?;
    }
    if let Some(current) = current {
        conn.execute(
            "INSERT INTO inspections (CarID, ClientID, Date) VALUES (?1, ?2, ?3)
             ON CONFLICT (CarID, Date) DO UPDATE SET ClientID = excluded.ClientID",
            params![car_id, client_id, current],
        )?;
    }
    Ok(())
}

fn preview(
    conn: &Connection,
    cars_sql: &str,
    inspections_where: &str,
    messages_where: &str,
    id: i64,
) -> Result<DeletePreview> {
    let mut statement = conn.prepare(cars_sql)?;
    let cars = statement
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let count = |table: &str, condition: &str| -> Result<i64> {
        Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE {condition}"), [id], |r| r.get(0))?)
    };
    Ok(DeletePreview {
        cars,
        inspections: count("inspections i", inspections_where)?,
        messages: count("messages m", messages_where)?,
    })
}

pub fn preview_delete_client(conn: &Connection, client_id: i64) -> Result<DeletePreview> {
    let cars = format!("SELECT {CAR_LABEL} FROM cars c WHERE c.CarID IN ({ORPHAN_CARS}) ORDER BY c.Plate");
    // The client's visits with cars that stay are kept, without the client.
    let inspections = format!("i.CarID IN ({ORPHAN_CARS})");
    let messages = format!("m.ClientID = ?1 OR m.CarID IN ({ORPHAN_CARS})");
    preview(conn, &cars, &inspections, &messages, client_id)
}

pub fn preview_delete_car(conn: &Connection, car_id: i64) -> Result<DeletePreview> {
    let cars = format!("SELECT {CAR_LABEL} FROM cars c WHERE c.CarID = ?1");
    preview(conn, &cars, "i.CarID = ?1", "m.CarID = ?1", car_id)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    fn code(code: &str) -> AppError {
        AppError::code(code)
    }

    fn client(conn: &mut Connection, phone: &str, car_ids: Vec<i64>) -> i64 {
        save_client(conn, ClientInput { client_id: None, sms_opt_out: false, phone: phone.into(), car_ids })
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
            inspected_by: None,
            notes: String::new(),
            feedback: false,
            new_phones: vec![],
            inspected_by_phone: None,
        }
    }

    fn car(conn: &mut Connection, plate: &str) -> i64 {
        save_car(conn, car_input(plate, None, 12)).unwrap().id
    }

    fn scalar(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn car_filter(search: &str) -> CarFilter {
        CarFilter {
            search: search.into(),
            frequency: None,
            revision_state: None,
            revision_from: None,
            revision_to: None,
            sort: Some("plate".into()),
            plate_prefix: None,
            page: 0,
        }
    }

    #[test]
    fn a_car_history_lists_every_inspection_newest_first() {
        let mut conn = test_connection();
        let id = save_car(&mut conn, car_input("B1AAA", Some("2024-05-01"), 12)).unwrap().id;
        save_car(&mut conn, CarInput { car_id: Some(id), ..car_input("B1AAA", Some("2025-05-02"), 12) })
            .unwrap();
        let history = car_history(&conn, id).unwrap();
        let dates: Vec<&str> = history.inspections.iter().map(|entry| entry.date.as_str()).collect();
        assert_eq!(dates, ["2025-05-02", "2024-05-01"]);
        assert!(history.messages.is_empty());
    }

    #[test]
    fn phones_are_shown_spaced() {
        assert_eq!(display_phone("0722123456"), "0722 123 456");
        assert_eq!(display_phone("+393331234567"), "+393331234567");
        assert_eq!(display_phones("0722000000, 0733000000"), "0722 000 000, 0733 000 000");
    }

    #[test]
    fn an_edited_car_moves_to_the_top() {
        let mut conn = test_connection();
        let first = car(&mut conn, "B1AAA");
        car(&mut conn, "B2AAA");
        // Times are kept to the millisecond.
        std::thread::sleep(std::time::Duration::from_millis(5));
        save_car(&mut conn, CarInput { car_id: Some(first), notes: "GPL".into(), ..car_input("B1AAA", None, 12) })
            .unwrap();
        let page = list_cars(&conn, CarFilter { sort: None, ..car_filter("") }).unwrap();
        assert_eq!(plates(page), ["B1AAA", "B2AAA"]);
    }

    #[test]
    fn cars_list_the_most_recently_added_first_by_default() {
        let mut conn = test_connection();
        for plate in ["B2AAA", "B1AAA", "B3AAA"] {
            car(&mut conn, plate);
        }
        // Added in the same second: the later one still comes first.
        let page = list_cars(&conn, CarFilter { sort: None, ..car_filter("") }).unwrap();
        assert!(page.rows.iter().all(|car| car.created_at.is_some()));
        assert_eq!(plates(page), ["B3AAA", "B1AAA", "B2AAA"]);
    }

    #[test]
    fn cars_can_be_looked_up_by_the_start_of_the_plate() {
        let mut conn = test_connection();
        for plate in ["B123ABC", "B12XYZ", "CJ12ABC"] {
            car(&mut conn, plate);
        }
        let found = |prefix: &str| {
            plates(list_cars(&conn, CarFilter { plate_prefix: Some(prefix.into()), ..car_filter("") }).unwrap())
        };
        assert_eq!(found("b 12"), ["B123ABC", "B12XYZ"]);
        assert_eq!(found("b-123"), ["B123ABC"]);
        assert!(found("12").is_empty());
    }

    #[test]
    fn the_feedback_choice_is_saved() {
        let mut conn = test_connection();
        let id = save_car(&mut conn, CarInput { feedback: true, ..car_input("B1AAA", None, 12) }).unwrap().id;
        assert!(cars_page(&conn, "B1AAA", None).rows[0].feedback);
        save_car(&mut conn, CarInput { car_id: Some(id), ..car_input("B1AAA", None, 12) }).unwrap();
        assert!(!cars_page(&conn, "B1AAA", None).rows[0].feedback);
    }

    fn cars_page(conn: &Connection, search: &str, state: Option<&str>) -> Page<Car> {
        list_cars(conn, CarFilter { revision_state: state.map(str::to_string), ..car_filter(search) })
            .unwrap()
    }

    fn plates(page: Page<Car>) -> Vec<String> {
        page.rows.into_iter().map(|car| car.plate).collect()
    }

    #[test]
    fn cars_sort_by_last_inspection_with_unknown_dates_last() {
        let mut conn = test_connection();
        save_car(&mut conn, car_input("B1AAA", Some("2024-05-01"), 12)).unwrap();
        save_car(&mut conn, car_input("B2AAA", None, 12)).unwrap();
        save_car(&mut conn, car_input("B3AAA", Some("2025-05-01"), 12)).unwrap();
        let sorted = |sort: &str| {
            plates(list_cars(&conn, CarFilter { sort: Some(sort.into()), ..car_filter("") }).unwrap())
        };
        assert_eq!(sorted("newest"), ["B3AAA", "B1AAA", "B2AAA"]);
        assert_eq!(sorted("oldest"), ["B1AAA", "B3AAA", "B2AAA"]);
    }

    #[test]
    fn cars_filter_by_last_inspection_range() {
        let mut conn = test_connection();
        for (plate, date) in [("B1AAA", "2025-04-30"), ("B2AAA", "2025-05-01"), ("B3AAA", "2025-05-31"), ("B4AAA", "2025-06-01")] {
            save_car(&mut conn, car_input(plate, Some(date), 12)).unwrap();
        }
        let filter = CarFilter {
            revision_from: Some("2025-05-01".into()),
            revision_to: Some("2025-05-31".into()),
            ..car_filter("")
        };
        assert_eq!(plates(list_cars(&conn, filter).unwrap()), ["B2AAA", "B3AAA"]);
    }

    #[test]
    fn typed_phones_become_clients_linked_to_the_car() {
        let mut conn = test_connection();
        let known = client(&mut conn, "0722000001", vec![]);
        let mut input = car_input("B1AAA", Some("2024-05-01"), 12);
        // One new number, and a known one written differently.
        input.new_phones = vec!["0733 000 002".into(), "+40722000001".into()];
        input.inspected_by_phone = Some("0733000002".into());
        let car_id = save_car(&mut conn, input).unwrap().id;

        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM clients"), 2);
        let new: i64 = conn
            .query_row("SELECT ClientID FROM clients WHERE Phone = '0733000002'", [], |r| r.get(0))
            .unwrap();
        let mut linked: Vec<i64> = cars_page(&conn, "", None).rows[0].clients.iter().map(|c| c.id).collect();
        linked.sort();
        assert_eq!(linked, [known, new]);
        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", Some(new))]);
    }

    #[test]
    fn other_information_is_saved_trimmed_and_searchable() {
        let mut conn = test_connection();
        let mut input = car_input("B1AAA", None, 12);
        input.notes = "  zgârietură ușă stânga, GPL  ".into();
        save_car(&mut conn, input).unwrap();
        save_car(&mut conn, car_input("B2AAA", None, 12)).unwrap();

        let found = cars_page(&conn, "gpl", None);
        assert_eq!(found.total, 1);
        assert_eq!(found.rows[0].notes, "zgârietură ușă stânga, GPL");
        assert_eq!(cars_page(&conn, "B2AAA", None).rows[0].notes, "");
    }

    #[test]
    fn an_empty_model_is_saved_as_a_dash() {
        let mut conn = test_connection();
        let mut input = car_input("B1AAA", None, 12);
        input.model = "  ".into();
        assert_eq!(save_car(&mut conn, input).unwrap().label, "B1AAA · Dacia -");
        assert_eq!(cars_page(&conn, "", None).rows[0].model, "-");

        let mut input = car_input("B2AAA", None, 12);
        input.manufacturer = " ".into();
        assert_eq!(save_car(&mut conn, input).err(), Some(code("required_fields")));
    }

    #[test]
    fn a_bad_typed_phone_saves_nothing() {
        let mut conn = test_connection();
        let mut input = car_input("B1AAA", None, 12);
        input.new_phones = vec!["12".into()];
        assert_eq!(save_car(&mut conn, input).err(), Some(code("invalid_phone")));
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM cars"), 0);
    }

    #[test]
    fn phone_variants_are_the_same_client() {
        let mut conn = test_connection();
        client(&mut conn, "0722 123-456", vec![]);
        for duplicate in ["0722123456", "+40722123456", "0040 722 123 456"] {
            let input = ClientInput { client_id: None, sms_opt_out: false, phone: duplicate.into(), car_ids: vec![] };
            assert_eq!(save_client(&mut conn, input).err(), Some(code("phone_exists")));
        }
    }

    #[test]
    fn rejects_invalid_phone() {
        let mut conn = test_connection();
        for phone in ["", "abc", "12"] {
            let input = ClientInput { client_id: None, sms_opt_out: false, phone: phone.into(), car_ids: vec![] };
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
            ClientInput { client_id: Some(id), sms_opt_out: false, phone: "0722000000".into(), car_ids: vec![second] },
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

    fn visits(conn: &Connection, car_id: i64) -> Vec<(String, Option<i64>)> {
        let mut query = conn
            .prepare("SELECT Date, ClientID FROM inspections WHERE CarID = ?1 ORDER BY Date")
            .unwrap();
        query
            .query_map([car_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn inspected(conn: &mut Connection, car_id: i64, date: Option<&str>, by: Option<i64>) {
        let mut input = car_input("B1AAA", date, 12);
        input.car_id = Some(car_id);
        input.inspected_by = by;
        save_car(conn, input).unwrap();
    }

    fn visit(date: &str, client: Option<i64>) -> (String, Option<i64>) {
        (date.to_string(), client)
    }

    #[test]
    fn a_later_inspection_date_adds_a_visit_with_its_client() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let first = client(&mut conn, "0722000001", vec![]);
        let second = client(&mut conn, "0722000002", vec![]);

        inspected(&mut conn, car_id, Some("2024-05-01"), Some(first));
        inspected(&mut conn, car_id, Some("2025-05-01"), Some(second));

        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", Some(first)), visit("2025-05-01", Some(second))]);
        assert_eq!(cars_page(&conn, "", None).rows[0].inspected_by, Some(second));
        // Whoever brought the car is linked to it, even if left out of the list.
        assert_eq!(scalar(&conn, "SELECT ClientID FROM carsclients"), second);
    }

    #[test]
    fn saving_the_same_date_only_changes_who_brought_the_car() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let first = client(&mut conn, "0722000001", vec![]);
        let second = client(&mut conn, "0722000002", vec![]);

        inspected(&mut conn, car_id, Some("2024-05-01"), Some(first));
        inspected(&mut conn, car_id, Some("2024-05-01"), Some(second));

        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", Some(second))]);
    }

    #[test]
    fn an_earlier_or_cleared_date_corrects_the_latest_visit() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");

        inspected(&mut conn, car_id, Some("2024-05-01"), None);
        inspected(&mut conn, car_id, Some("2025-05-10"), None);
        inspected(&mut conn, car_id, Some("2025-05-01"), None);
        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", None), visit("2025-05-01", None)]);

        inspected(&mut conn, car_id, None, None);
        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", None)]);
    }

    #[test]
    fn a_new_car_with_a_date_starts_its_history() {
        let mut conn = test_connection();
        let client_id = client(&mut conn, "0722000001", vec![]);
        let mut input = car_input("B1AAA", Some("2024-05-01"), 12);
        input.client_ids = vec![client_id];
        input.inspected_by = Some(client_id);
        let car_id = save_car(&mut conn, input).unwrap().id;

        assert_eq!(visits(&conn, car_id), [visit("2024-05-01", Some(client_id))]);
    }

    #[test]
    fn inspection_date_cannot_be_in_the_future() {
        let mut conn = test_connection();
        assert_eq!(
            save_car(&mut conn, car_input("B1AAA", Some("2999-01-01"), 12)).err(),
            Some(code("revision_in_future"))
        );
    }

    #[test]
    fn deleting_client_keeps_shared_cars() {
        let mut conn = test_connection();
        let own = car(&mut conn, "B1AAA");
        let shared = car(&mut conn, "B2AAA");
        let leaving = client(&mut conn, "0722000000", vec![own, shared]);
        let other = client(&mut conn, "0733000000", vec![shared]);
        inspected(&mut conn, own, Some("2024-05-01"), Some(leaving));
        let mut shared_input = car_input("B2AAA", Some("2024-06-01"), 12);
        shared_input.car_id = Some(shared);
        shared_input.client_ids = vec![leaving, other];
        shared_input.inspected_by = Some(leaving);
        save_car(&mut conn, shared_input).unwrap();

        let preview = preview_delete_client(&conn, leaving).unwrap();
        assert_eq!(preview.cars, vec!["B1AAA · Dacia Logan".to_string()]);
        assert_eq!(preview.inspections, 1);

        delete_client(&mut conn, leaving).unwrap();

        assert_eq!(scalar(&conn, "SELECT CarID FROM cars"), shared);
        assert_eq!(scalar(&conn, "SELECT ClientID FROM clients"), other);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM carsclients"), 1);
        assert_eq!(visits(&conn, shared), [visit("2024-06-01", None)]);
    }

    #[test]
    fn deleting_car_keeps_clients() {
        let mut conn = test_connection();
        let car_id = car(&mut conn, "B1AAA");
        let client_id = client(&mut conn, "0722000000", vec![car_id]);
        inspected(&mut conn, car_id, Some("2024-05-01"), Some(client_id));

        assert_eq!(preview_delete_car(&conn, car_id).unwrap().inspections, 1);
        delete_car(&conn, car_id).unwrap();

        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM inspections"), 0);
        assert_eq!(scalar(&conn, "SELECT COUNT(*) FROM clients"), 1);
    }

    #[test]
    fn deleting_missing_records_reports_not_found() {
        let mut conn = test_connection();
        assert_eq!(delete_client(&mut conn, 99).err(), Some(code("not_found")));
        assert_eq!(delete_car(&conn, 99).err(), Some(code("not_found")));
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
