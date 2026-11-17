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
/// Feedback requests and thank-yous can be sent for this many days after the inspection,
/// counting its day.
pub const AFTER_VISIT_DAYS: i64 = 7;
pub const KIND_INSPECTION: &str = "inspection";
pub const KIND_FEEDBACK: &str = "feedback";
pub const KIND_THANKS: &str = "thanks";
pub const KIND_CUSTOM: &str = "custom";
/// ITP reminders go by WhatsApp or by SMS; everything else by WhatsApp.
pub const CHANNEL_SMS: &str = "sms";
pub const CHANNEL_WHATSAPP: &str = "whatsapp";
/// The texts that can be edited; custom messages carry their own.
const TEMPLATE_KINDS: [&str; 3] = [KIND_INSPECTION, KIND_FEEDBACK, KIND_THANKS];
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
    /// The custom message this belongs to.
    pub custom_id: Option<i64>,
    /// The custom message has a picture to send with it.
    pub has_image: bool,
    /// The last attempt in this round (this inspection cycle, visit or custom message):
    /// "unsent", "sent" or "failed". Sent ones can still be sent again.
    pub status: String,
    /// When that last attempt was made.
    pub last_attempt: Option<String>,
    /// For ITP reminders, which go by either channel: the last attempt through the other
    /// channel ("unsent", "sent" or "failed") and when it was made.
    pub other_status: Option<String>,
    pub other_attempt: Option<String>,
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
    /// For custom messages, their name (empty once the custom message is deleted).
    custom_name: Option<String>,
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
}

/// A message written for the cars inspected in a period.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomMessage {
    #[serde(default)]
    id: Option<i64>,
    name: String,
    text: String,
    /// Inspections from this day to `to`, both included.
    from: String,
    to: String,
    /// The picture as a data URL, for showing it; not read when saving.
    #[serde(default, skip_deserializing)]
    image: Option<String>,
}

/// A picture to send, ready for the WhatsApp page.
pub struct MessageImage {
    pub mime: String,
    pub base64: String,
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
        let message = |channel: &str, own: (&String, &Option<String>), other: (&String, &Option<String>)| {
            PendingMessage {
                key: format!("{KIND_INSPECTION}:{channel}:{client_id}:{car_id}"),
                kind: KIND_INSPECTION.to_string(),
                channel: channel.to_string(),
                client_id,
                car_id: Some(car_id),
                phone: phone.clone(),
                text: text.clone(),
                plate: Some(plate.clone()),
                due_date: due_date.clone(),
                custom_id: None,
                has_image: false,
                status: own.0.clone(),
                last_attempt: own.1.clone(),
                other_status: Some(other.0.clone()),
                other_attempt: other.1.clone(),
            }
        };
        // Every reminder can go by either channel; each copy says how the other one went.
        let by_whatsapp = (&whatsapp_status, &whatsapp_at);
        let by_sms = (&sms_status, &sms_at);
        messages.push(message(CHANNEL_WHATSAPP, by_whatsapp, by_sms));
        messages.push(message(CHANNEL_SMS, by_sms, by_whatsapp));
    }
    Ok(messages)
}

/// A thank-you or a feedback request for every car inspected in the last `AFTER_VISIT_DAYS`,
/// to whoever brought it, or to every linked client when that is not known. Cars whose client
/// agreed to give feedback (the Feedback box in the car form) get the request; the others get
/// the thank-you. Each client gets one per inspection.
fn due_after_visit(conn: &Connection, today: &str, kind: &str) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, kind)?;
    let mut statement = conn.prepare(&format!(
        "WITH visits AS MATERIALIZED (
             SELECT InspectionID, CarID, ClientID, Date FROM inspections
             WHERE Date BETWEEN date(?1, '-{back} days') AND ?1
         ),
         recipients AS (
             SELECT InspectionID, ClientID FROM visits WHERE ClientID IS NOT NULL
             UNION ALL
             SELECT v.InspectionID, l.ClientID FROM visits v
             JOIN carsclients l ON l.CarID = v.CarID WHERE v.ClientID IS NULL
         )
         SELECT c.CarID, c.Plate, cl.ClientID, cl.Phone, v.Date,
                (SELECT m.Status || '|' || m.SentAt FROM messages m INDEXED BY messages_car
                 WHERE m.Type = ?2 AND m.ClientID = cl.ClientID AND m.CarID = c.CarID
                   AND substr(m.SentAt, 1, 10) >= v.Date
                 ORDER BY m.SentAt DESC, m.MessageID DESC LIMIT 1)
         FROM recipients r
         JOIN visits v ON v.InspectionID = r.InspectionID
         JOIN cars c ON c.CarID = v.CarID
         JOIN clients cl ON cl.ClientID = r.ClientID
         WHERE cl.SmsOptOut = 0 AND c.Feedback = ?3
         ORDER BY v.Date DESC, c.Plate, cl.Phone",
        back = AFTER_VISIT_DAYS - 1,
    ))?;
    let wants_feedback = kind == KIND_FEEDBACK;
    let rows = statement.query_map(params![today, kind, wants_feedback], |row| {
        let car_id: i64 = row.get(0)?;
        let plate: String = row.get(1)?;
        let client_id: i64 = row.get(2)?;
        let date: String = row.get(4)?;
        let (status, last_attempt) = attempt(row.get(5)?);
        Ok(PendingMessage {
            key: format!("{kind}:{client_id}:{car_id}:{date}"),
            kind: kind.to_string(),
            channel: CHANNEL_WHATSAPP.to_string(),
            client_id,
            car_id: Some(car_id),
            phone: row.get(3)?,
            text: wording.replace("{plate}", &plate),
            plate: Some(plate),
            due_date: date,
            custom_id: None,
            has_image: false,
            status,
            last_attempt,
            other_status: None,
            other_attempt: None,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every custom message, to the cars inspected in its period: to whoever brought the car to
/// its latest inspection there, or to every linked client when that is not known.
fn due_custom(conn: &Connection) -> Result<Vec<PendingMessage>> {
    let mut customs = conn.prepare(
        "SELECT CustomID, Text, FromDate, ToDate, Image IS NOT NULL FROM custom_messages ORDER BY CustomID",
    )?;
    let customs = customs
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare(
        "WITH visits AS MATERIALIZED (
             SELECT i.InspectionID, i.CarID, i.ClientID, i.Date FROM inspections i
             WHERE i.Date BETWEEN ?1 AND ?2
               AND i.Date = (SELECT MAX(i2.Date) FROM inspections i2
                             WHERE i2.CarID = i.CarID AND i2.Date BETWEEN ?1 AND ?2)
         ),
         recipients AS (
             SELECT InspectionID, ClientID FROM visits WHERE ClientID IS NOT NULL
             UNION ALL
             SELECT v.InspectionID, l.ClientID FROM visits v
             JOIN carsclients l ON l.CarID = v.CarID WHERE v.ClientID IS NULL
         )
         SELECT c.CarID, c.Plate, cl.ClientID, cl.Phone, v.Date,
                (SELECT m.Status || '|' || m.SentAt FROM messages m INDEXED BY messages_car
                 WHERE m.CustomID = ?3 AND m.ClientID = cl.ClientID AND m.CarID = c.CarID
                 ORDER BY m.SentAt DESC, m.MessageID DESC LIMIT 1)
         FROM recipients r
         JOIN visits v ON v.InspectionID = r.InspectionID
         JOIN cars c ON c.CarID = v.CarID
         JOIN clients cl ON cl.ClientID = r.ClientID
         WHERE cl.SmsOptOut = 0
         ORDER BY v.Date DESC, c.Plate, cl.Phone",
    )?;
    let mut all = Vec::new();
    for (custom_id, wording, from, to, has_image) in customs {
        let rows = statement.query_map(params![from, to, custom_id], |row| {
            let car_id: i64 = row.get(0)?;
            let plate: String = row.get(1)?;
            let client_id: i64 = row.get(2)?;
            let (status, last_attempt) = attempt(row.get(5)?);
            Ok(PendingMessage {
                key: format!("{KIND_CUSTOM}:{custom_id}:{client_id}:{car_id}"),
                kind: KIND_CUSTOM.to_string(),
                channel: CHANNEL_WHATSAPP.to_string(),
                client_id,
                car_id: Some(car_id),
                phone: row.get(3)?,
                text: wording.replace("{plate}", &plate),
                plate: Some(plate),
                due_date: row.get(4)?,
                custom_id: Some(custom_id),
                has_image,
                status,
                last_attempt,
                other_status: None,
                other_attempt: None,
            })
        })?;
        all.extend(rows.collect::<rusqlite::Result<Vec<_>>>()?);
    }
    Ok(all)
}

fn pending_at(conn: &Connection, today: &str, days: i64) -> Result<Vec<PendingMessage>> {
    let mut all = due_inspections(conn, today, days)?;
    all.extend(due_custom(conn)?);
    all.extend(due_after_visit(conn, today, KIND_FEEDBACK)?);
    all.extend(due_after_visit(conn, today, KIND_THANKS)?);
    Ok(all)
}

/// Debug builds can pretend it is another day, to try the lists on other dates. Sends are then
/// recorded on that day too, so a message is not offered again.
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
        "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status, Channel, CustomID)
         VALUES (?1, ?2, ?3, ?4,
                 COALESCE(?6, date('now', 'localtime')) || strftime('T%H:%M:%S', 'now', 'localtime'), ?5, ?7, ?8)",
        params![
            message.client_id,
            message.car_id,
            message.kind,
            message.text,
            if sent { "sent" } else { "failed" },
            today_override(),
            message.channel,
            message.custom_id,
        ],
    )?;
    Ok(())
}

/// Which sent messages to list.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryFilter {
    /// "sms" or "whatsapp".
    pub channel: String,
    /// "sent" or "failed"; every message when empty.
    #[serde(default)]
    pub status: Option<String>,
    /// Matched against the phone, the plate and the text.
    #[serde(default)]
    pub search: String,
    /// Sent between these days, both included.
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

/// Messages sent through one channel, newest first, narrowed by `filter`.
pub fn history(conn: &Connection, page: i64, filter: &HistoryFilter) -> Result<Page<SentMessage>> {
    let search = filter.search.trim();
    let text = (!search.is_empty()).then_some(search);
    // Phones are stored as digits and plates without spaces, so "0722 123" and "b 12" match.
    let digits: String = search.chars().filter(char::is_ascii_digit).collect();
    let digits = (digits.len() >= 3).then_some(digits);
    let plate: String = search.chars().filter(char::is_ascii_alphanumeric).flat_map(char::to_uppercase).collect();
    let plate = (!plate.is_empty()).then_some(plate);
    // ?1 and ?2 are the page; the count leaves them unused.
    let matching = "FROM messages m
         JOIN clients cl ON cl.ClientID = m.ClientID
         LEFT JOIN cars c ON c.CarID = m.CarID
         WHERE m.Channel = ?3 AND (?4 IS NULL OR m.Status = ?4)
           AND (?5 IS NULL OR m.Text LIKE '%' || ?5 || '%'
                OR cl.Phone LIKE '%' || ?6 || '%' OR c.Plate LIKE '%' || ?7 || '%')
           AND (?8 IS NULL OR substr(m.SentAt, 1, 10) >= ?8)
           AND (?9 IS NULL OR substr(m.SentAt, 1, 10) <= ?9)";
    let values = params![
        data::PAGE_SIZE,
        page * data::PAGE_SIZE,
        filter.channel,
        filter.status,
        text,
        digits,
        plate,
        filter.from,
        filter.to
    ];
    let total: i64 = conn.query_row(&format!("SELECT COUNT(*) {matching}"), values, |row| row.get(0))?;
    let mut statement = conn.prepare(&format!(
        "SELECT m.MessageID, m.Type, m.Channel, cl.Phone, c.Plate, m.Text, m.SentAt, m.Status,
                (SELECT cm.Name FROM custom_messages cm WHERE cm.CustomID = m.CustomID)
         {matching}
         ORDER BY m.SentAt DESC, m.MessageID DESC
         LIMIT ?1 OFFSET ?2"
    ))?;
    let rows = statement
        .query_map(values, |row| {
            Ok(SentMessage {
                message_id: row.get(0)?,
                kind: row.get(1)?,
                channel: row.get(2)?,
                phone: row.get(3)?,
                plate: row.get(4)?,
                text: row.get(5)?,
                sent_at: row.get(6)?,
                status: row.get(7)?,
                custom_name: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Page { rows, total })
}

pub fn templates(conn: &Connection) -> Result<Vec<Template>> {
    let mut statement = conn.prepare(
        "SELECT Type, Text FROM sms_templates
         ORDER BY CASE Type WHEN 'inspection' THEN 0 WHEN 'feedback' THEN 1 ELSE 2 END",
    )?;
    let rows = statement
        .query_map([], |row| Ok(Template { kind: row.get(0)?, text: row.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn save_template(conn: &Connection, input: Template) -> Result<()> {
    let text = input.text.trim();
    if text.is_empty() || !TEMPLATE_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::code("required_fields"));
    }
    conn.execute("UPDATE sms_templates SET Text = ?1 WHERE Type = ?2", params![text, input.kind])?;
    Ok(())
}

/// Every custom message, the newest first.
pub fn custom_messages(conn: &Connection) -> Result<Vec<CustomMessage>> {
    let mut statement = conn.prepare(
        "SELECT CustomID, Name, Text, FromDate, ToDate, Image, ImageType FROM custom_messages
         ORDER BY CustomID DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            let image: Option<Vec<u8>> = row.get(5)?;
            let mime: Option<String> = row.get(6)?;
            Ok(CustomMessage {
                id: row.get(0)?,
                name: row.get(1)?,
                text: row.get(2)?,
                from: row.get(3)?,
                to: row.get(4)?,
                image: image
                    .zip(mime)
                    .map(|(bytes, mime)| format!("data:{mime};base64,{}", BASE64.encode(bytes))),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Adds or changes a custom message; returns its id. The picture is set on its own.
pub fn save_custom_message(conn: &Connection, input: CustomMessage) -> Result<i64> {
    let name = input.name.trim();
    let text = input.text.trim();
    if name.is_empty() || text.is_empty() {
        return Err(AppError::code("required_fields"));
    }
    for day in [&input.from, &input.to] {
        if !data::has_format(conn, "%Y-%m-%d", day)? {
            return Err(AppError::code("invalid_date"));
        }
    }
    if input.from > input.to {
        return Err(AppError::code("invalid_date"));
    }
    match input.id {
        Some(id) => {
            let changed = conn.execute(
                "UPDATE custom_messages SET Name = ?1, Text = ?2, FromDate = ?3, ToDate = ?4 WHERE CustomID = ?5",
                params![name, text, input.from, input.to, id],
            )?;
            if changed == 0 {
                return Err(AppError::code("not_found"));
            }
            Ok(id)
        }
        None => {
            conn.execute(
                "INSERT INTO custom_messages (Name, Text, FromDate, ToDate, CreatedAt)
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))",
                params![name, text, input.from, input.to],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }
}

/// Deletes a custom message. Messages already sent stay in the history.
pub fn delete_custom_message(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM custom_messages WHERE CustomID = ?1", [id])?;
    Ok(())
}

/// Sets a custom message's picture from base64 file contents. Only JPEG and PNG, up to
/// `MAX_IMAGE_BYTES`.
pub fn save_custom_image(conn: &Connection, id: i64, data: &str, mime: &str) -> Result<()> {
    if !IMAGE_TYPES.contains(&mime) {
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
        "UPDATE custom_messages SET Image = ?1, ImageType = ?2 WHERE CustomID = ?3",
        params![bytes, mime, id],
    )?;
    Ok(())
}

pub fn remove_custom_image(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE custom_messages SET Image = NULL, ImageType = NULL WHERE CustomID = ?1", [id])?;
    Ok(())
}

/// The picture to send with a custom message, if it has one.
pub fn custom_image(conn: &Connection, id: i64) -> Result<Option<MessageImage>> {
    let found: Option<(Option<Vec<u8>>, Option<String>)> = conn
        .query_row("SELECT Image, ImageType FROM custom_messages WHERE CustomID = ?1", [id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?;
    Ok(found.and_then(|(bytes, mime)| {
        Some(MessageImage { base64: BASE64.encode(bytes?), mime: mime? })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    const TODAY: &str = "2030-06-15";
    const DAYS: i64 = DEFAULT_REMINDER_DAYS;

    fn add_car(conn: &Connection, plate: &str, last: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency, Feedback)
             VALUES (?1, 'Dacia', 'Logan', ?2, 12, 1)",
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

    /// What is still to send: everything not sent yet; a reminder counts once, and is done
    /// when it went through either channel.
    fn phones_on(conn: &Connection, today: &str) -> Vec<(String, String)> {
        pending_at(conn, today, DAYS)
            .unwrap()
            .into_iter()
            .filter(|message| message.status != "sent" && message.other_status.as_deref() != Some("sent"))
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
        // Once for WhatsApp and once for SMS.
        assert_eq!(found.len(), 2);
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
    fn feedback_goes_to_whoever_brought_a_car_inspected_this_week() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some(TODAY));
        // The owner is linked but did not come, so gets nothing.
        add_client(&conn, "0722000001", Some(car));
        let driver = add_client(&conn, "0722000002", Some(car));
        inspect(&conn, Some(driver), car, TODAY);
        // Inspected eight days ago: past the week.
        let earlier = add_car(&conn, "B2AAA", Some("2030-06-07"));
        let other = add_client(&conn, "0722000003", Some(earlier));
        inspect(&conn, Some(other), earlier, "2030-06-07");

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
    fn feedback_is_only_asked_for_cars_marked_for_it() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some(TODAY));
        conn.execute("UPDATE cars SET Feedback = 0 WHERE CarID = ?1", [car]).unwrap();
        let driver = add_client(&conn, "0722000001", Some(car));
        inspect(&conn, Some(driver), car, TODAY);
        assert!(kinds_on(&conn, TODAY, "feedback").is_empty());
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
    fn feedback_and_thanks_stay_for_a_week_after_the_inspection() {
        let conn = test_connection();
        let asked = add_car(&conn, "B1AAA", Some("2030-06-09"));
        let thanked = add_car(&conn, "B2AAA", Some("2030-06-09"));
        conn.execute("UPDATE cars SET Feedback = 0 WHERE CarID = ?1", [thanked]).unwrap();
        let first = add_client(&conn, "0722000001", Some(asked));
        let second = add_client(&conn, "0722000002", Some(thanked));
        inspect(&conn, Some(first), asked, "2030-06-09");
        inspect(&conn, Some(second), thanked, "2030-06-09");

        // 9 June is the first of the seven days up to 15 June.
        assert_eq!(kinds_on(&conn, TODAY, KIND_FEEDBACK), ["0722000001"]);
        assert_eq!(kinds_on(&conn, TODAY, KIND_THANKS), ["0722000002"]);
        assert!(kinds_on(&conn, "2030-06-16", KIND_FEEDBACK).is_empty());
        assert!(kinds_on(&conn, "2030-06-16", KIND_THANKS).is_empty());
        let thanks = pending_at(&conn, TODAY, DAYS).unwrap().into_iter().find(|m| m.kind == KIND_THANKS).unwrap();
        assert!(thanks.text.contains("B2AAA"), "{}", thanks.text);
        assert_eq!(thanks.channel, CHANNEL_WHATSAPP);
    }

    #[test]
    fn custom_messages_go_to_the_cars_inspected_in_their_period() {
        let conn = test_connection();
        let inside = add_car(&conn, "B1AAA", Some("2030-03-10"));
        let outside = add_car(&conn, "B2AAA", Some("2030-05-10"));
        let owner = add_client(&conn, "0722000001", Some(inside));
        let other = add_client(&conn, "0722000002", Some(outside));
        inspect(&conn, Some(owner), inside, "2030-03-01");
        inspect(&conn, Some(owner), inside, "2030-03-10");
        inspect(&conn, Some(other), outside, "2030-05-10");

        let message = |id: Option<i64>, text: &str| CustomMessage {
            id,
            name: "Primăvară".into(),
            text: text.into(),
            from: "2030-03-01".into(),
            to: "2030-03-31".into(),
            image: None,
        };
        let id = save_custom_message(&conn, message(None, "Salut {plate}!")).unwrap();
        let custom: Vec<PendingMessage> =
            pending_at(&conn, TODAY, DAYS).unwrap().into_iter().filter(|m| m.kind == KIND_CUSTOM).collect();
        // Once per car, for its latest visit in the period.
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].text, "Salut B1AAA!");
        assert_eq!(custom[0].due_date, "2030-03-10");
        assert_eq!(custom[0].custom_id, Some(id));

        record(&conn, &custom[0], true).unwrap();
        let again = pending_at(&conn, TODAY, DAYS).unwrap().into_iter().find(|m| m.kind == KIND_CUSTOM).unwrap();
        assert_eq!(again.status, "sent");

        save_custom_message(&conn, message(Some(id), "Altceva")).unwrap();
        assert_eq!(custom_messages(&conn).unwrap()[0].text, "Altceva");
        delete_custom_message(&conn, id).unwrap();
        assert!(pending_at(&conn, TODAY, DAYS).unwrap().iter().all(|m| m.kind != KIND_CUSTOM));
        // What was sent stays in the history.
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM messages WHERE Type = 'custom'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn custom_messages_need_a_name_text_and_a_period_in_order() {
        let conn = test_connection();
        let message = |name: &str, from: &str, to: &str| CustomMessage {
            id: None,
            name: name.into(),
            text: "Salut".into(),
            from: from.into(),
            to: to.into(),
            image: None,
        };
        assert_eq!(save_custom_message(&conn, message(" ", "2030-01-01", "2030-01-31")), Err(AppError::code("required_fields")));
        assert_eq!(save_custom_message(&conn, message("A", "2030-02-01", "2030-01-31")), Err(AppError::code("invalid_date")));
        assert_eq!(save_custom_message(&conn, message("A", "2030-02-30", "2030-03-01")), Err(AppError::code("invalid_date")));
    }

    #[test]
    fn custom_messages_can_carry_a_small_jpeg_or_png_picture() {
        let conn = test_connection();
        let id = save_custom_message(
            &conn,
            CustomMessage { id: None, name: "A".into(), text: "B".into(), from: "2030-01-01".into(), to: "2030-01-02".into(), image: None },
        )
        .unwrap();
        let png = BASE64.encode([0x89, b'P', b'N', b'G']);
        save_custom_image(&conn, id, &png, "image/png").unwrap();
        assert_eq!(custom_image(&conn, id).unwrap().unwrap().mime, "image/png");
        assert!(custom_messages(&conn).unwrap()[0].image.as_deref().unwrap().starts_with("data:image/png;base64,"));
        let invalid = Some(AppError::code("image_invalid"));
        assert_eq!(save_custom_image(&conn, id, &png, "image/gif").err(), invalid);
        assert_eq!(save_custom_image(&conn, id, "not base64!", "image/png").err(), invalid);
        let large = BASE64.encode(vec![0u8; MAX_IMAGE_BYTES + 1]);
        assert_eq!(save_custom_image(&conn, id, &large, "image/jpeg").err(), Some(AppError::code("image_too_large")));
        remove_custom_image(&conn, id).unwrap();
        assert!(custom_image(&conn, id).unwrap().is_none());
    }

    #[test]
    fn templates_can_be_edited_but_not_emptied() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        save_template(&conn, Template { kind: "inspection".into(), text: " Salut {plate} ".into() }).unwrap();
        assert_eq!(pending_at(&conn, TODAY, DAYS).unwrap()[0].text, "Salut B1AAA");

        let empty = Template { kind: "inspection".into(), text: "  ".into() };
        assert_eq!(save_template(&conn, empty), Err(AppError::code("required_fields")));
        let gone = Template { kind: "christmas".into(), text: "Crăciun fericit".into() };
        assert_eq!(save_template(&conn, gone), Err(AppError::code("required_fields")));
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

        let by = |channel: &str, status: Option<&str>| {
            history(
                &conn,
                0,
                &HistoryFilter {
                    channel: channel.into(),
                    status: status.map(str::to_string),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let sms = by(CHANNEL_SMS, None);
        assert_eq!(sms.total, 2);
        assert_eq!(sms.rows[0].status, "sent");
        assert_eq!(sms.rows[1].plate.as_deref(), Some("B1AAA"));
        let failed = by(CHANNEL_SMS, Some("failed"));
        assert_eq!(failed.total, 1);
        assert_eq!(failed.rows[0].status, "failed");
        let whatsapp = by(CHANNEL_WHATSAPP, None);
        assert_eq!(whatsapp.total, 1);
        assert_eq!(whatsapp.rows[0].kind, "christmas");
    }

    #[test]
    fn history_can_be_searched_and_limited_to_days() {
        let conn = test_connection();
        let car = add_car(&conn, "B12ABC", None);
        let client = add_client(&conn, "0722000001", Some(car));
        let other = add_client(&conn, "0733000002", None);
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "sent");
        log(&conn, other, None, "inspection", "2030-06-20T10:00:00", "sent");
        let found = |search: &str, from: Option<&str>, to: Option<&str>| {
            let filter = HistoryFilter {
                channel: CHANNEL_SMS.into(),
                search: search.into(),
                from: from.map(str::to_string),
                to: to.map(str::to_string),
                ..Default::default()
            };
            history(&conn, 0, &filter).unwrap().total
        };
        assert_eq!(found("", None, None), 2);
        assert_eq!(found("0722 000", None, None), 1);
        assert_eq!(found("b 12", None, None), 1);
        assert_eq!(found("", Some("2030-06-15"), None), 1);
        assert_eq!(found("", Some("2030-06-14"), Some("2030-06-14")), 1);
        assert_eq!(found("nimic", None, None), 0);
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
    fn every_reminder_can_go_by_whatsapp_or_sms_and_shows_how_the_other_went() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(car));
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "unsent"), pair(CHANNEL_SMS, "unsent")]);

        log_by(&conn, client, Some(car), "inspection", "2030-06-10T10:00:00", "failed", CHANNEL_WHATSAPP);
        log(&conn, client, Some(car), "inspection", "2030-06-11T10:00:00", "sent");
        assert_eq!(reminders(&conn), [pair(CHANNEL_WHATSAPP, "failed"), pair(CHANNEL_SMS, "sent")]);

        let all = pending_at(&conn, TODAY, DAYS).unwrap();
        let whatsapp = all.iter().find(|m| m.channel == CHANNEL_WHATSAPP).unwrap();
        assert_eq!(whatsapp.other_status.as_deref(), Some("sent"));
        assert_eq!(whatsapp.other_attempt.as_deref(), Some("2030-06-11T10:00:00"));
        let sms = all.iter().find(|m| m.channel == CHANNEL_SMS).unwrap();
        assert_eq!(sms.key, format!("inspection:sms:{client}:{car}"));
        assert_eq!(sms.last_attempt.as_deref(), Some("2030-06-11T10:00:00"));
        assert_eq!(sms.other_status.as_deref(), Some("failed"));
    }


}
