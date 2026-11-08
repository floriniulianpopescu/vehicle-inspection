//! Works out which messages are due, and keeps the message history.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::data::{self, AppError, Page};

type Result<T> = std::result::Result<T, AppError>;

const REMINDER_DAYS: i64 = 30;
const GREETING_LEAD_DAYS: i64 = 3;
pub const KIND_INSPECTION: &str = "inspection";
const KINDS: [&str; 4] = [KIND_INSPECTION, "christmas", "new_year", "easter"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingMessage {
    pub key: String,
    pub kind: String,
    pub client_id: i64,
    pub car_id: Option<i64>,
    pub phone: String,
    pub plate: Option<String>,
    pub due_date: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentMessage {
    message_id: i64,
    kind: String,
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

fn due_inspections(conn: &Connection, today: &str, now: &str) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, KIND_INSPECTION)?;
    let sql = format!(
        "WITH due AS (
             SELECT c.CarID, c.Plate, c.LastRevision, {next} AS NextRevision,
                    (SELECT a.ClientID FROM appointments a WHERE a.CarID = c.CarID
                     ORDER BY a.TimeDate DESC LIMIT 1) AS LatestClient
             FROM cars c
             WHERE c.LastRevision IS NOT NULL
               AND {next} <= date(?1, '+{REMINDER_DAYS} days')
               AND NOT EXISTS (SELECT 1 FROM appointments a
                               WHERE a.CarID = c.CarID AND a.IsDone = 0 AND a.TimeDate >= ?2)
         )
         SELECT d.CarID, d.Plate, d.NextRevision, cl.ClientID, cl.Phone
         FROM due d
         JOIN clients cl ON cl.ClientID = d.LatestClient
             OR (d.LatestClient IS NULL AND cl.ClientID IN
                 (SELECT l.ClientID FROM carsclients l WHERE l.CarID = d.CarID))
         WHERE cl.SmsOptOut = 0
           AND NOT EXISTS (SELECT 1 FROM messages m
                           WHERE m.CarID = d.CarID AND m.ClientID = cl.ClientID
                             AND m.Type = 'inspection' AND m.Status = 'sent'
                             AND substr(m.SentAt, 1, 10) >= d.LastRevision)
         ORDER BY d.NextRevision, d.Plate, cl.Phone",
        next = data::NEXT_REVISION,
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![today, now], |row| {
        let car_id: i64 = row.get(0)?;
        let plate: String = row.get(1)?;
        let due_date: String = row.get(2)?;
        let client_id: i64 = row.get(3)?;
        Ok(PendingMessage {
            key: format!("{KIND_INSPECTION}:{client_id}:{car_id}"),
            kind: KIND_INSPECTION.to_string(),
            client_id,
            car_id: Some(car_id),
            phone: row.get(4)?,
            text: wording.replace("{plate}", &plate).replace("{date}", &display_date(&due_date)),
            plate: Some(plate),
            due_date,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn due_greetings(conn: &Connection, holiday: &Holiday) -> Result<Vec<PendingMessage>> {
    let wording = template(conn, holiday.kind)?;
    let mut statement = conn.prepare(
        "SELECT cl.ClientID, cl.Phone FROM clients cl
         WHERE cl.SmsOptOut = 0
           AND NOT EXISTS (SELECT 1 FROM messages m
                           WHERE m.ClientID = cl.ClientID AND m.Type = ?1 AND m.Status = 'sent'
                             AND substr(m.SentAt, 1, 10) BETWEEN ?2 AND ?3)
         ORDER BY cl.Phone",
    )?;
    let rows = statement.query_map(params![holiday.kind, holiday.window_start, holiday.date], |row| {
        let client_id: i64 = row.get(0)?;
        Ok(PendingMessage {
            key: format!("{}:{client_id}:{}", holiday.kind, holiday.date),
            kind: holiday.kind.to_string(),
            client_id,
            car_id: None,
            phone: row.get(1)?,
            plate: None,
            due_date: holiday.date.clone(),
            text: wording.clone(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn pending_at(conn: &Connection, today: &str, now: &str) -> Result<Vec<PendingMessage>> {
    let mut all = due_inspections(conn, today, now)?;
    for holiday in active_holidays(conn, today)? {
        all.extend(due_greetings(conn, &holiday)?);
    }
    Ok(all)
}

pub fn pending(conn: &Connection) -> Result<Vec<PendingMessage>> {
    let (today, now): (String, String) = conn.query_row(
        "SELECT date('now', 'localtime'), strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    pending_at(conn, &today, &now)
}

pub fn record(conn: &Connection, message: &PendingMessage, sent: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status)
         VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'), ?5)",
        params![
            message.client_id,
            message.car_id,
            message.kind,
            message.text,
            if sent { "sent" } else { "failed" }
        ],
    )?;
    Ok(())
}

pub fn history(conn: &Connection, page: i64) -> Result<Page<SentMessage>> {
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
    let mut statement = conn.prepare(
        "SELECT m.MessageID, m.Type, cl.Phone, c.Plate, m.Text, m.SentAt, m.Status
         FROM messages m
         JOIN clients cl ON cl.ClientID = m.ClientID
         LEFT JOIN cars c ON c.CarID = m.CarID
         ORDER BY m.SentAt DESC, m.MessageID DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = statement
        .query_map(params![data::PAGE_SIZE, page * data::PAGE_SIZE], |row| {
            Ok(SentMessage {
                message_id: row.get(0)?,
                kind: row.get(1)?,
                phone: row.get(2)?,
                plate: row.get(3)?,
                text: row.get(4)?,
                sent_at: row.get(5)?,
                status: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Page { rows, total })
}

pub fn templates(conn: &Connection) -> Result<Vec<Template>> {
    let mut statement = conn.prepare(
        "SELECT Type, Text FROM sms_templates
         ORDER BY CASE Type WHEN 'inspection' THEN 0 WHEN 'christmas' THEN 1
                            WHEN 'new_year' THEN 2 ELSE 3 END",
    )?;
    let rows = statement
        .query_map([], |row| Ok(Template { kind: row.get(0)?, text: row.get(1)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
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
    const NOW: &str = "2030-06-15T12:00";

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

    fn book(conn: &Connection, client: i64, car: i64, time: &str, done: bool) {
        conn.execute(
            "INSERT INTO appointments (ClientID, CarID, TimeDate, Duration, IsDone)
             VALUES (?1, ?2, ?3, 30, ?4)",
            params![client, car, time, done],
        )
        .unwrap();
    }

    fn log(conn: &Connection, client: i64, car: Option<i64>, kind: &str, at: &str, status: &str) {
        conn.execute(
            "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status)
             VALUES (?1, ?2, ?3, 'x', ?4, ?5)",
            params![client, car, kind, at, status],
        )
        .unwrap();
    }

    fn phones_on(conn: &Connection, today: &str) -> Vec<(String, String)> {
        pending_at(conn, today, &format!("{today}T12:00"))
            .unwrap()
            .into_iter()
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
        let found = pending_at(&conn, TODAY, NOW).unwrap();
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
    fn recipient_is_the_latest_appointments_client() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let older = add_client(&conn, "0722000001", Some(car));
        let latest = add_client(&conn, "0722000002", Some(car));
        book(&conn, older, car, "2029-01-01T09:00", true);
        book(&conn, latest, car, "2029-07-15T09:00", true);

        assert_eq!(phones(&conn), [inspection("0722000002")]);
    }

    #[test]
    fn without_appointments_every_linked_client_is_listed() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        add_client(&conn, "0722000002", Some(car));

        assert_eq!(phones(&conn), [inspection("0722000001"), inspection("0722000002")]);
    }

    #[test]
    fn upcoming_appointment_skips_the_reminder_but_a_missed_one_does_not() {
        let conn = test_connection();
        let booked = add_car(&conn, "B1AAA", Some("2029-07-15"));
        let client = add_client(&conn, "0722000001", Some(booked));
        book(&conn, client, booked, "2030-06-20T09:00", false);
        let missed = add_car(&conn, "B2AAA", Some("2029-07-15"));
        let other = add_client(&conn, "0722000002", Some(missed));
        book(&conn, other, missed, "2030-06-10T09:00", false);

        assert_eq!(phones(&conn), [inspection("0722000002")]);
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
    fn templates_can_be_edited_but_not_emptied() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-07-15"));
        add_client(&conn, "0722000001", Some(car));
        save_template(&conn, Template { kind: "inspection".into(), text: " Salut {plate} ".into() }).unwrap();
        assert_eq!(pending_at(&conn, TODAY, NOW).unwrap()[0].text, "Salut B1AAA");

        let empty = Template { kind: "inspection".into(), text: "  ".into() };
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
    fn history_lists_newest_first_with_paging_totals() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None);
        let client = add_client(&conn, "0722000001", Some(car));
        log(&conn, client, Some(car), "inspection", "2030-06-14T10:00:00", "failed");
        log(&conn, client, None, "christmas", "2030-06-15T10:00:00", "sent");

        let page = history(&conn, 0).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.rows[0].kind, "christmas");
        assert_eq!(page.rows[1].plate.as_deref(), Some("B1AAA"));
    }
}
