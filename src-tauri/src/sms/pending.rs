//! Works out which messages are due, and keeps the message history.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::data::{self, AppError, Page};

type Result<T> = std::result::Result<T, AppError>;

pub const DEFAULT_REMINDER_DAYS: i64 = 30;
/// About six months.
pub const MAX_REMINDER_DAYS: i64 = 180;
const GREETING_LEAD_DAYS: i64 = 3;
pub const KIND_INSPECTION: &str = "inspection";
pub const KIND_FEEDBACK: &str = "feedback";
/// ITP reminders go by WhatsApp first and by SMS to whoever WhatsApp fails; greetings and
/// feedback go by WhatsApp.
pub const CHANNEL_SMS: &str = "sms";
pub const CHANNEL_WHATSAPP: &str = "whatsapp";
const KINDS: [&str; 5] = [KIND_INSPECTION, "christmas", "new_year", "easter", KIND_FEEDBACK];
/// Only greetings can carry a picture.
const GREETING_KINDS: [&str; 3] = ["christmas", "new_year", "easter"];
const IMAGE_TYPES: [&str; 2] = ["image/jpeg", "image/png"];
/// WhatsApp shrinks pictures anyway; larger files only slow sending down.
pub const MAX_IMAGE_BYTES: usize = 3 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingMessage {
    pub key: String,
    pub kind: String,
    pub channel: String,
    pub client_id: i64,
    pub car_id: Option<i64>,
    pub phone: String,
    pub plate: Option<String>,
    pub due_date: String,
    pub text: String,
    /// The greeting has a picture to send with it.
    pub has_image: bool,
    /// The last attempt in this round (this inspection cycle, holiday or visit):
    /// "unsent", "sent" or "failed". Sent ones can still be sent again.
    pub status: String,
    /// When that last attempt was made.
    pub last_attempt: Option<String>,
}

pub const STATUS_UNSENT: &str = "unsent";

/// Splits "sent|2026-11-14T10:00:00" from the status subqueries.
fn attempt(value: Option<String>) -> (String, Option<String>) {
    match value.as_deref().and_then(|value| value.split_once('|')) {
        Some((status, at)) => (status.to_string(), Some(at.to_string())),
        None => (STATUS_UNSENT.to_string(), None),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentMessage {
    message_id: i64,
    kind: String,
    channel: String,
    phone: String,
    plate: Option<String>,
    text: String,
    sent_at: String,
    status: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    kind: String,
    text: String,
    /// The greeting's picture as a data URL, for showing it; not read when saving.
    #[serde(default, skip_deserializing)]
    image: Option<String>,
}

/// A picture to send, ready for the WhatsApp page.
pub struct MessageImage {
    pub mime: String,
    pub base64: String,
}

/// Orthodox Easter for a year between 1900 and 2099, as the Julian date
/// (month, day). The Gregorian date is 13 days later.
fn julian_orthodox_easter(year: i32) -> (i32, i32) {
    let (a, b, c) = (year % 4, year % 7, year % 19);
    let d = (19 * c + 15) % 30;
    let e = (2 * a + 4 * b - d + 34) % 7;
    let total = d + e + 114;
    (total / 31, total % 31 + 1)
}

fn orthodox_easter(conn: &Connection, year: i32) -> Result<String> {
    let (month, day) = julian_orthodox_easter(year);
    Ok(conn.query_row(
        "SELECT date(printf('%04d-%02d-%02d', ?1, ?2, ?3), '+13 days')",
        params![year, month, day],
        |row| row.get(0),
    )?)
}

struct Holiday {
    kind: &'static str,
    date: String,
    window_start: String,
}

/// The holidays whose greeting window includes `today`.
fn active_holidays(conn: &Connection, today: &str) -> Result<Vec<Holiday>> {
    let year: i32 = today[..4].parse().map_err(|_| AppError::code("invalid_date"))?;
    let mut active = Vec::new();
    for candidate_year in [year, year + 1] {
        let dates = [
            ("christmas", format!("{candidate_year}-12-25")),
            ("new_year", format!("{candidate_year}-01-01")),
            ("easter", orthodox_easter(conn, candidate_year)?),
        ];
        for (kind, date) in dates {
            let window_start: String = conn.query_row(
                "SELECT date(?1, ?2)",
                params![date, format!("-{GREETING_LEAD_DAYS} days")],
                |row| row.get(0),
            )?;
            if window_start.as_str() <= today && today <= date.as_str() {
                active.push(Holiday { kind, date, window_start });
            }
        }
    }
    Ok(active)
}

fn template(conn: &Connection, kind: &str) -> Result<String> {
    Ok(conn.query_row("SELECT Text FROM sms_templates WHERE Type = ?1", [kind], |row| row.get(0))?)
}

fn display_date(iso: &str) -> String {
    let parts: Vec<&str> = iso.split('-').collect();
    match parts.as_slice() {
        [year, month, day] => format!("{day}.{month}.{year}"),
        _ => iso.to_string(),
    }
}

/// The latest attempt for a reminder in this inspection cycle, through one channel, as
/// "status|time". Needs `d` (the due car) and `cl` (the client) in scope.
///
/// The status lookups name their index: left to itself SQLite walks the whole message log in
/// date order for every row (seconds with a few thousand cars) instead of reading the few
/// messages of that car or client.
fn reminder_attempt(channel: &str) -> String {
    format!(
        "(SELECT m.Status || '|' || m.SentAt FROM messages m INDEXED BY messages_car
          WHERE m.CarID = d.CarID AND m.ClientID = cl.ClientID AND m.Type = 'inspection'
            AND m.Channel = '{channel}' AND substr(m.SentAt, 1, 10) >= d.LastRevision
          ORDER BY m.SentAt DESC, m.MessageID DESC LIMIT 1)"
    )
}

/// Cars due within `days`, overdue ones included. The reminder goes to whoever brought the car
/// to its latest inspection, or to every linked client when that is not known.
///
/// Each one is offered by WhatsApp; once WhatsApp has failed for it (or it was already tried by
/// SMS), it is offered by SMS as well.
fn due_inspections(conn: &Connection, today: &str, days: i64) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, KIND_INSPECTION)?;
    let sql = format!(
        "WITH due AS MATERIALIZED (
             SELECT c.CarID, c.Plate, c.LastRevision, {next} AS NextRevision,
                    (SELECT i.ClientID FROM inspections i WHERE i.CarID = c.CarID
                     ORDER BY i.Date DESC LIMIT 1) AS LatestClient
             FROM cars c
             WHERE c.LastRevision IS NOT NULL
               AND {next} <= date(?1, '+' || ?2 || ' days')
         ),
         -- Two plain lookups instead of one join with OR, which made SQLite compare every due
         -- car with every client (seconds with a few thousand cars).
         recipients AS (
             SELECT CarID, LatestClient AS ClientID FROM due WHERE LatestClient IS NOT NULL
             UNION ALL
             SELECT d.CarID, l.ClientID FROM due d JOIN carsclients l ON l.CarID = d.CarID
             WHERE d.LatestClient IS NULL
         )
         SELECT d.CarID, d.Plate, d.NextRevision, cl.ClientID, cl.Phone,
                {whatsapp} AS WhatsApp, {sms} AS Sms
         FROM recipients r
         JOIN due d ON d.CarID = r.CarID
         JOIN clients cl ON cl.ClientID = r.ClientID
         WHERE cl.SmsOptOut = 0
         ORDER BY d.NextRevision, d.Plate, cl.Phone",
        next = data::NEXT_REVISION,
        whatsapp = reminder_attempt(CHANNEL_WHATSAPP),
        sms = reminder_attempt(CHANNEL_SMS),
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![today, days], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    })?;
    let mut messages = Vec::new();
    for row in rows {
        let (car_id, plate, due_date, client_id, phone, whatsapp, sms) = row?;
        let text = wording.replace("{plate}", &plate).replace("{date}", &display_date(&due_date));
        let (whatsapp_status, whatsapp_at) = attempt(whatsapp);
        let (sms_status, sms_at) = attempt(sms);
        let tried_by_whatsapp = whatsapp_status != STATUS_UNSENT;
        let tried_by_sms = sms_status != STATUS_UNSENT;
        let message = |channel: &str, status: String, last_attempt: Option<String>| PendingMessage {
            key: format!("{KIND_INSPECTION}:{channel}:{client_id}:{car_id}"),
            kind: KIND_INSPECTION.to_string(),
            channel: channel.to_string(),
            client_id,
            car_id: Some(car_id),
            phone: phone.clone(),
            text: text.clone(),
            plate: Some(plate.clone()),
            due_date: due_date.clone(),
            has_image: false,
            status,
            last_attempt,
        };
        // Before WhatsApp existed reminders went by SMS; one already delivered that way counts
        // as sent here too, so it is not offered again by default.
        let (status, at) = if !tried_by_whatsapp && sms_status == "sent" {
            (sms_status.clone(), sms_at.clone())
        } else {
            (whatsapp_status.clone(), whatsapp_at)
        };
        messages.push(message(CHANNEL_WHATSAPP, status, at));
        if whatsapp_status == "failed" || tried_by_sms {
            messages.push(message(CHANNEL_SMS, sms_status, sms_at));
        }
    }
    Ok(messages)
}

fn due_greetings(conn: &Connection, holiday: &Holiday) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, holiday.kind)?;
    let has_image: bool = conn.query_row(
        "SELECT Image IS NOT NULL FROM sms_templates WHERE Type = ?1",
        [holiday.kind],
        |row| row.get(0),
    )?;
    let mut statement = conn.prepare(
        "SELECT cl.ClientID, cl.Phone,
                (SELECT m.Status || '|' || m.SentAt FROM messages m INDEXED BY messages_client
                 WHERE m.ClientID = cl.ClientID AND m.Type = ?1
                   AND substr(m.SentAt, 1, 10) BETWEEN ?2 AND ?3
                 ORDER BY m.SentAt DESC, m.MessageID DESC LIMIT 1)
         FROM clients cl
         WHERE cl.SmsOptOut = 0
         ORDER BY cl.Phone",
    )?;
    let rows = statement.query_map(params![holiday.kind, holiday.window_start, holiday.date], |row| {
        let client_id: i64 = row.get(0)?;
        let (status, last_attempt) = attempt(row.get(2)?);
        Ok(PendingMessage {
            key: format!("{}:{client_id}:{}", holiday.kind, holiday.date),
            kind: holiday.kind.to_string(),
            channel: CHANNEL_WHATSAPP.to_string(),
            client_id,
            car_id: None,
            phone: row.get(1)?,
            plate: None,
            due_date: holiday.date.clone(),
            text: wording.clone(),
            has_image,
            status,
            last_attempt,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A request for feedback for every car inspected today, to whoever brought it, or to every
/// linked client when that is not known. Each client gets one per inspection.
fn due_feedback(conn: &Connection, today: &str) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, KIND_FEEDBACK)?;
    let mut statement = conn.prepare(
        "SELECT c.CarID, c.Plate, cl.ClientID, cl.Phone, i.Date,
                (SELECT m.Status || '|' || m.SentAt FROM messages m INDEXED BY messages_car
                 WHERE m.Type = 'feedback' AND m.ClientID = cl.ClientID AND m.CarID = c.CarID
                   AND substr(m.SentAt, 1, 10) >= i.Date
                 ORDER BY m.SentAt DESC, m.MessageID DESC LIMIT 1)
         FROM inspections i
         JOIN cars c ON c.CarID = i.CarID
         JOIN (SELECT i2.InspectionID, i2.ClientID FROM inspections i2
               WHERE i2.Date = ?1 AND i2.ClientID IS NOT NULL
               UNION ALL
               SELECT i2.InspectionID, l.ClientID FROM inspections i2
               JOIN carsclients l ON l.CarID = i2.CarID
               WHERE i2.Date = ?1 AND i2.ClientID IS NULL) r ON r.InspectionID = i.InspectionID
         JOIN clients cl ON cl.ClientID = r.ClientID
         WHERE i.Date = ?1 AND cl.SmsOptOut = 0
         ORDER BY c.Plate, cl.Phone",
    )?;
    let rows = statement.query_map([today], |row| {
        let car_id: i64 = row.get(0)?;
        let plate: String = row.get(1)?;
        let client_id: i64 = row.get(2)?;
        let date: String = row.get(4)?;
        let (status, last_attempt) = attempt(row.get(5)?);
        Ok(PendingMessage {
            key: format!("{KIND_FEEDBACK}:{client_id}:{car_id}:{date}"),
            kind: KIND_FEEDBACK.to_string(),
            channel: CHANNEL_WHATSAPP.to_string(),
            client_id,
            car_id: Some(car_id),
            phone: row.get(3)?,
            text: wording.replace("{plate}", &plate),
            plate: Some(plate),
            due_date: date,
            has_image: false,
            status,
            last_attempt,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn pending_at(conn: &Connection, today: &str, days: i64) -> Result<Vec<PendingMessage>> {
    let mut all = due_inspections(conn, today, days)?;
    for holiday in active_holidays(conn, today)? {
        all.extend(due_greetings(conn, &holiday)?);
    }
    all.extend(due_feedback(conn, today)?);
    Ok(all)
}

/// Debug builds can pretend it is another day, to try the greetings outside the holidays.
/// Sends are then recorded on that day too, so a greeting is not offered again.
fn today_override() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(today) = std::env::var("VEHICLE_INSPECTION_TODAY") {
        return Some(today);
    }
    None
}

pub fn pending(conn: &Connection, days: i64) -> Result<Vec<PendingMessage>> {
    let today: String = match today_override() {
        Some(today) => today,
        None => conn.query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))?,
    };
    pending_at(conn, &today, days)
}

pub fn record(conn: &Connection, message: &PendingMessage, sent: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status, Channel)
         VALUES (?1, ?2, ?3, ?4,
                 COALESCE(?6, date('now', 'localtime')) || strftime('T%H:%M:%S', 'now', 'localtime'), ?5, ?7)",
        params![
            message.client_id,
            message.car_id,
            message.kind,
            message.text,
            if sent { "sent" } else { "failed" },
            today_override(),
            message.channel,
        ],
    )?;
    Ok(())
}

/// Messages sent through one channel ("sms" or "whatsapp"), newest first, optionally only
/// those with one status ("sent" or "failed").
pub fn history(conn: &Connection, page: i64, channel: &str, status: Option<&str>) -> Result<Page<SentMessage>> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE Channel = ?1 AND (?2 IS NULL OR Status = ?2)",
        params![channel, status],
        |row| row.get(0),
    )?;
    let mut statement = conn.prepare(
        "SELECT m.MessageID, m.Type, m.Channel, cl.Phone, c.Plate, m.Text, m.SentAt, m.Status
         FROM messages m
         JOIN clients cl ON cl.ClientID = m.ClientID
         LEFT JOIN cars c ON c.CarID = m.CarID
         WHERE m.Channel = ?3 AND (?4 IS NULL OR m.Status = ?4)
         ORDER BY m.SentAt DESC, m.MessageID DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = statement
        .query_map(params![data::PAGE_SIZE, page * data::PAGE_SIZE, channel, status], |row| {
            Ok(SentMessage {
                message_id: row.get(0)?,
                kind: row.get(1)?,
                channel: row.get(2)?,
                phone: row.get(3)?,
                plate: row.get(4)?,
                text: row.get(5)?,
                sent_at: row.get(6)?,
                status: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Page { rows, total })
}

pub fn templates(conn: &Connection) -> Result<Vec<Template>> {
    let mut statement = conn.prepare(
        "SELECT Type, Text, Image, ImageType FROM sms_templates
         ORDER BY CASE Type WHEN 'inspection' THEN 0 WHEN 'christmas' THEN 1
                            WHEN 'new_year' THEN 2 WHEN 'easter' THEN 3 ELSE 4 END",
    )?;
    let rows = statement
        .query_map([], |row| {
            let image: Option<Vec<u8>> = row.get(2)?;
            let mime: Option<String> = row.get(3)?;
            Ok(Template {
                kind: row.get(0)?,
                text: row.get(1)?,
                image: image.zip(mime).map(|(bytes, mime)| {
                    format!("data:{mime};base64,{}", BASE64.encode(bytes))
                }),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Sets a greeting's picture from base64 file contents. Only JPEG and PNG, up to
/// `MAX_IMAGE_BYTES`.
pub fn save_template_image(conn: &Connection, kind: &str, data: &str, mime: &str) -> Result<()> {
    if !GREETING_KINDS.contains(&kind) || !IMAGE_TYPES.contains(&mime) {
        return Err(AppError::code("image_invalid"));
    }
    let bytes = BASE64.decode(data.trim()).map_err(|_| AppError::code("image_invalid"))?;
    if bytes.is_empty() {
        return Err(AppError::code("image_invalid"));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::code("image_too_large"));
    }
    conn.execute(
        "UPDATE sms_templates SET Image = ?1, ImageType = ?2 WHERE Type = ?3",
        params![bytes, mime, kind],
    )?;
    Ok(())
}

pub fn remove_template_image(conn: &Connection, kind: &str) -> Result<()> {
    conn.execute("UPDATE sms_templates SET Image = NULL, ImageType = NULL WHERE Type = ?1", [kind])?;
    Ok(())
}

/// The picture to send with this kind of message, if it has one.
pub fn template_image(conn: &Connection, kind: &str) -> Result<Option<MessageImage>> {
    let found: Option<(Option<Vec<u8>>, Option<String>)> = conn
        .query_row("SELECT Image, ImageType FROM sms_templates WHERE Type = ?1", [kind], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    Ok(found.and_then(|(bytes, mime)| {
        Some(MessageImage { base64: BASE64.encode(bytes?), mime: mime? })
    }))
}

pub fn save_template(conn: &Connection, input: Template) -> Result<()> {
    let text = input.text.trim();
    if text.is_empty() || !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::code("required_fields"));
    }
    conn.execute("UPDATE sms_templates SET Text = ?1 WHERE Type = ?2", params![text, input.kind])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    const TODAY: &str = "2030-06-15";
    const DAYS: i64 = DEFAULT_REMINDER_DAYS;

    fn add_car(conn: &Connection, plate: &str, last: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency)
             VALUES (?1, 'Dacia', 'Logan', ?2, 12)",
            params![plate, last],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_client(conn: &Connection, phone: &str, car: Option<i64>) -> i64 {
        conn.execute("INSERT INTO clients (Phone) VALUES (?1)", [phone]).unwrap();
        let id = conn.last_insert_rowid();
        if let Some(car) = car {
            conn.execute("INSERT INTO carsclients (CarID, ClientID) VALUES (?1, ?2)", params![car, id])
                .unwrap();
        }
        id
    }

    fn inspect(conn: &Connection, client: Option<i64>, car: i64, date: &str) {
        conn.execute(
            "INSERT INTO inspections (ClientID, CarID, Date) VALUES (?1, ?2, ?3)",
            params![client, car, date],
        )
        .unwrap();
    }

    fn log(conn: &Connection, client: i64, car: Option<i64>, kind: &str, at: &str, status: &str) {
        log_by(conn, client, car, kind, at, status, CHANNEL_SMS);
    }

    fn log_by(conn: &Connection, client: i64, car: Option<i64>, kind: &str, at: &str, status: &str, channel: &str) {
        conn.execute(
            "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status, Channel)
             VALUES (?1, ?2, ?3, 'x', ?4, ?5, ?6)",
            params![client, car, kind, at, status, channel],
        )
        .unwrap();
    }

    /// What is still to send: everything not sent yet, reminders by their first channel.
    fn phones_on(conn: &Connection, today: &str) -> Vec<(String, String)> {
        pending_at(conn, today, DAYS)
            .unwrap()
            .into_iter()
            .filter(|message| message.status != "sent")
            .filter(|message| message.kind != KIND_INSPECTION || message.channel == CHANNEL_WHATSAPP)
            .map(|message| (message.kind, message.phone))
            .collect()
    }

    fn phones(conn: &Connection) -> Vec<(String, String)> {
        phones_on(conn, TODAY)
    }

    fn inspection(phone: &str) -> (String, String) {
        ("inspection".to_string(), phone.to_string())
    }

    fn greeting(kind: &str, phone: &str) -> (String, String) {
        (kind.to_string(), phone.to_string())
    }

    #[test]
    fn orthodox_easter_matches_known_dates() {
        let conn = test_connection();
        for (year, date) in [
            (2024, "2024-05-05"),
            (2025, "2025-04-20"),
            (2026, "2026-04-12"),
            (2027, "2027-05-02"),
            (2028, "2028-04-16"),
        ] {
            assert_eq!(orthodox_easter(&conn, year).unwrap(), date);
        }
    }

    #[test]
    fn reminder_appears_exactly_thirty_days_before() {
        let conn = test_connection();
        // Next inspection 2030-07-15 is exactly 30 days after 2030-06-15.
        let inside = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(inside));
        let outside = add_car(&conn, "B2AAA", Some("2029-07-16"));
        add_client(&conn, "0722000002", Some(outside));

        assert_eq!(phones(&conn), [inspection("0722000001")]);
    }

    #[test]
    fn text_is_filled_in() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        let found = pending_at(&conn, TODAY, DAYS).unwrap();
        assert!(found[0].text.contains("B1AAA"), "{}", found[0].text);
        assert!(found[0].text.contains("15.07.2030"), "{}", found[0].text);
    }

    #[test]
    fn overdue_cars_are_listed_and_unknown_dates_are_not() {
        let conn = test_connection();
        let overdue = add_car(&conn, "B1AAA", Some("2029-01-01"));
        add_client(&conn, "0722000001", Some(overdue));
        let unknown = add_car(&conn, "B2AAA", None);
        add_client(&conn, "0722000002", Some(unknown));

        assert_eq!(phones(&conn), [inspection("0722000001")]);
    }

    #[test]
    fn the_window_follows_the_chosen_number_of_days() {
        let conn = test_connection();
        // Next inspection 2030-12-12 is 180 days after 2030-06-15.
        let car = add_car(&conn, "B1AAA", Some("2029-12-12"));
        add_client(&conn, "0722000001", Some(car));

        assert!(phones(&conn).is_empty());
        let found = pending_at(&conn, TODAY, MAX_REMINDER_DAYS).unwrap();
        assert_eq!(found.len(), 1);
        assert!(pending_at(&conn, TODAY, MAX_REMINDER_DAYS - 1).unwrap().is_empty());
    }

    #[test]
    fn recipient_is_whoever_brought_the_car_last() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let older = add_client(&conn, "0722000001", Some(car));
        let latest = add_client(&conn, "0722000002", Some(car));
        inspect(&conn, Some(older), car, "2028-07-15");
        inspect(&conn, Some(latest), car, "2029-07-15");

        assert_eq!(phones(&conn), [inspection("0722000002")]);
    }

    #[test]
    fn without_a_known_client_every_linked_client_is_listed() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        add_client(&conn, "0722000002", Some(car));
        inspect(&conn, None, car, "2029-07-15");

        assert_eq!(phones(&conn), [inspection("0722000001"), inspection("0722000002")]);
    }

    fn kinds_on(conn: &Connection, today: &str, kind: &str) -> Vec<String> {
        pending_at(conn, today, DAYS)
            .unwrap()
            .into_iter()
            .filter(|message| message.kind == kind && message.status != "sent")
            .map(|message| message.phone)
            .collect()
    }

    #[test]
    fn feedback_goes_to_whoever_brought_a_car_inspected_today() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some(TODAY));
        // The owner is linked but did not come, so gets nothing.
        add_client(&conn, "0722000001", Some(car));
        let driver = add_client(&conn, "0722000002", Some(car));
        inspect(&conn, Some(driver), car, TODAY);
        // Inspected yesterday: no feedback today.
        let earlier = add_car(&conn, "B2AAA", Some("2030-06-14"));
        let other = add_client(&conn, "0722000003", Some(earlier));
        inspect(&conn, Some(other), earlier, "2030-06-14");

        assert_eq!(kinds_on(&conn, TODAY, "feedback"), ["0722000002"]);
        let message = pending_at(&conn, TODAY, DAYS)
            .unwrap()
            .into_iter()
            .find(|message| message.kind == "feedback")
            .unwrap();
        assert_eq!(message.channel, CHANNEL_WHATSAPP);
        assert!(message.text.contains("B1AAA"), "{}", message.text);
    }

    #[test]
    fn feedback_without_a_known_client_goes_to_every_linked_client_once() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some(TODAY));
        let first = add_client(&conn, "0722000001", Some(car));
        add_client(&conn, "0722000002", Some(car));
        inspect(&conn, None, car, TODAY);
        assert_eq!(kinds_on(&conn, TODAY, "feedback"), ["0722000001", "0722000002"]);

        log(&conn, first, Some(car), "feedback", &format!("{TODAY}T15:00:00"), "sent");
        assert_eq!(kinds_on(&conn, TODAY, "feedback"), ["0722000002"]);
        // An opted-out client is skipped too.
        conn.execute("UPDATE clients SET SmsOptOut = 1 WHERE Phone = '0722000002'", []).unwrap();
        assert!(kinds_on(&conn, TODAY, "feedback").is_empty());
    }

    #[test]
    fn opted_out_clients_get_nothing() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        conn.execute("UPDATE clients SET SmsOptOut = 1 WHERE ClientID = ?1", [client]).unwrap();

        assert!(phones(&conn).is_empty());
        assert!(phones_on(&conn, "2030-12-25").is_empty());
    }

    #[test]
    fn a_sent_reminder_stays_gone_until_the_next_inspection_is_recorded() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "sent");
        assert!(phones(&conn).is_empty());

        // A year later the car was inspected again and is due again.
        conn.execute("UPDATE cars SET LastRevision = '2030-07-10' WHERE CarID = ?1", [car]).unwrap();
        assert_eq!(phones_on(&conn, "2031-06-15"), [inspection("0722000001")]);
    }

    #[test]
    fn a_failed_reminder_stays_listed() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "failed");
        assert_eq!(phones(&conn), [inspection("0722000001")]);
    }

    #[test]
    fn with_two_recipients_one_failure_stays_listed() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let first = add_client(&conn, "0722000001", Some(car));
        add_client(&conn, "0722000002", Some(car));
        log(&conn, first, Some(car), "inspection", "2030-06-14T10:00:00", "sent");

        assert_eq!(phones(&conn), [inspection("0722000002")]);
    }

    #[test]
    fn greetings_appear_three_days_before_and_end_after_the_day() {
        let conn = test_connection();
        add_client(&conn, "0722000001", None);
        let christmas = [greeting("christmas", "0722000001")];

        assert!(phones_on(&conn, "2030-12-21").is_empty());
        assert_eq!(phones_on(&conn, "2030-12-22"), christmas);
        assert_eq!(phones_on(&conn, "2030-12-25"), christmas);
        assert!(phones_on(&conn, "2030-12-26").is_empty());
    }

    #[test]
    fn new_year_window_crosses_the_year_end() {
        let conn = test_connection();
        add_client(&conn, "0722000001", None);
        let new_year = [greeting("new_year", "0722000001")];

        assert_eq!(phones_on(&conn, "2030-12-29"), new_year);
        assert_eq!(phones_on(&conn, "2031-01-01"), new_year);
        assert!(phones_on(&conn, "2031-01-02").is_empty());
    }

    #[test]
    fn easter_uses_the_orthodox_date() {
        let conn = test_connection();
        add_client(&conn, "0722000001", None);
        assert_eq!(phones_on(&conn, "2026-04-12"), [greeting("easter", "0722000001")]);
        assert!(phones_on(&conn, "2026-04-05").is_empty());
    }

    #[test]
    fn one_greeting_per_holiday_but_again_next_year() {
        let conn = test_connection();
        let client = add_client(&conn, "0722000001", None);
        log(&conn, client, None, "christmas", "2030-12-23T10:00:00", "sent");

        assert!(phones_on(&conn, "2030-12-25").is_empty());
        assert_eq!(phones_on(&conn, "2031-12-25"), [greeting("christmas", "0722000001")]);
    }

    #[test]
    fn greetings_can_carry_a_picture() {
        let conn = test_connection();
        add_client(&conn, "0722000001", None);
        let png = BASE64.encode([137u8, 80, 78, 71]);
        save_template_image(&conn, "christmas", &png, "image/png").unwrap();

        let christmas = pending_at(&conn, "2030-12-24", DAYS).unwrap();
        assert!(christmas[0].has_image);
        assert!(!pending_at(&conn, "2030-12-30", DAYS).unwrap()[0].has_image);
        let image = template_image(&conn, "christmas").unwrap().unwrap();
        assert_eq!((image.mime.as_str(), image.base64.as_str()), ("image/png", png.as_str()));
        let listed = templates(&conn).unwrap();
        let shown = listed.iter().find(|t| t.kind == "christmas").unwrap();
        assert_eq!(shown.image.as_deref(), Some(format!("data:image/png;base64,{png}").as_str()));

        remove_template_image(&conn, "christmas").unwrap();
        assert!(template_image(&conn, "christmas").unwrap().is_none());
    }

    #[test]
    fn only_greetings_take_small_jpeg_or_png_pictures() {
        let conn = test_connection();
        let small = BASE64.encode([1u8, 2, 3]);
        let invalid = Some(AppError::code("image_invalid"));
        assert_eq!(save_template_image(&conn, "inspection", &small, "image/png").err(), invalid);
        assert_eq!(save_template_image(&conn, "easter", &small, "image/gif").err(), invalid);
        assert_eq!(save_template_image(&conn, "easter", "not base64!", "image/png").err(), invalid);
        let large = BASE64.encode(vec![0u8; MAX_IMAGE_BYTES + 1]);
        assert_eq!(
            save_template_image(&conn, "easter", &large, "image/jpeg").err(),
            Some(AppError::code("image_too_large"))
        );
    }

    #[test]
    fn templates_can_be_edited_but_not_emptied() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        save_template(&conn, Template { kind: "inspection".into(), text: " Salut {plate} ".into(), image: None })
            .unwrap();
        assert_eq!(pending_at(&conn, TODAY, DAYS).unwrap()[0].text, "Salut B1AAA");

        let empty = Template { kind: "inspection".into(), text: "  ".into(), image: None };
        assert_eq!(save_template(&conn, empty), Err(AppError::code("required_fields")));
    }

    #[test]
    fn deleting_a_client_or_car_removes_their_messages() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        let other = add_client(&conn, "0722000002", Some(car));
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "sent");
        log(&conn, other, None, "christmas", "2029-12-23T10:00:00", "sent");
        let count = |conn: &Connection| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0)).unwrap()
        };

        conn.execute("DELETE FROM cars WHERE CarID = ?1", [car]).unwrap();
        assert_eq!(count(&conn), 1);
        conn.execute("DELETE FROM clients WHERE ClientID = ?1", [other]).unwrap();
        assert_eq!(count(&conn), 0);
    }

    #[test]
    fn history_is_split_by_channel_newest_first() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None);
        let client = add_client(&conn, "0722000001", Some(car));
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "failed");
        log(&conn, client, Some(car), "inspection", "2030-06-15T10:00:00", "sent");
        log_by(&conn, client, None, "christmas", "2030-06-15T11:00:00", "sent", CHANNEL_WHATSAPP);

        let sms = history(&conn, 0, CHANNEL_SMS, None).unwrap();
        assert_eq!(sms.total, 2);
        assert_eq!(sms.rows[0].status, "sent");
        assert_eq!(sms.rows[1].plate.as_deref(), Some("B1AAA"));
        let failed = history(&conn, 0, CHANNEL_SMS, Some("failed")).unwrap();
        assert_eq!(failed.total, 1);
        assert_eq!(failed.rows[0].status, "failed");
        let whatsapp = history(&conn, 0, CHANNEL_WHATSAPP, None).unwrap();
        assert_eq!(whatsapp.total, 1);
        assert_eq!(whatsapp.rows[0].kind, "christmas");
    }

    fn reminders(conn: &Connection) -> Vec<(String, String)> {
        pending_at(conn, TODAY, DAYS)
            .unwrap()
            .into_iter()
            .filter(|message| message.kind == KIND_INSPECTION)
            .map(|message| (message.channel, message.status))
            .collect()
    }

    fn pair(channel: &str, status: &str) -> (String, String) {
        (channel.to_string(), status.to_string())
    }

    #[test]
    fn reminders_go_by_whatsapp_first_and_by_sms_after_a_whatsapp_failure() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "unsent")]);

        log_by(&conn, client, Some(car), "inspection", "2030-06-10T10:00:00", "failed", CHANNEL_WHATSAPP);
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "failed"), pair(CHANNEL_SMS, "unsent")]);

        log(&conn, client, Some(car), "inspection", "2030-06-11T10:00:00", "sent");
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "failed"), pair(CHANNEL_SMS, "sent")]);
        let sms = pending_at(&conn, TODAY, DAYS).unwrap().into_iter().find(|m| m.channel == CHANNEL_SMS).unwrap();
        assert_eq!(sms.key, format!("inspection:sms:{client}:{car}"));
        assert_eq!(sms.last_attempt.as_deref(), Some("2030-06-11T10:00:00"));
    }

    #[test]
    fn a_whatsapp_reminder_that_went_through_offers_no_sms() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        log_by(&conn, client, Some(car), "inspection", "2030-06-10T10:00:00", "sent", CHANNEL_WHATSAPP);
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "sent")]);
    }

    #[test]
    fn sent_greetings_stay_listed_with_their_status_to_send_again() {
        let conn = test_connection();
        let client = add_client(&conn, "0722000001", None);
        add_client(&conn, "0722000002", None);
        log_by(&conn, client, None, "christmas", "2030-12-23T10:00:00", "sent", CHANNEL_WHATSAPP);

        let statuses: Vec<(String, String)> = pending_at(&conn, "2030-12-24", DAYS)
            .unwrap()
            .into_iter()
            .map(|message| (message.phone, message.status))
            .collect();
        assert_eq!(
            statuses,
            [("0722000001".to_string(), "sent".to_string()), ("0722000002".to_string(), "unsent".to_string())]
        );
    }

}
