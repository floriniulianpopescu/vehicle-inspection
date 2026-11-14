//! Lists behind the Reports page and its .xlsx export.

use std::fs;
use std::path::PathBuf;

use rusqlite::{Connection, Row, params};
use rust_xlsxwriter::{Color, ExcelDateTime, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};
use serde::{Deserialize, Serialize};

use crate::data::{self, AppError};

/// About six months, the same limit as the SMS reminders.
pub const MAX_EXPIRING_DAYS: i64 = 180;
const HEADER_FILL: u32 = 0xEEEEEA;
const OVER_FILL: u32 = 0xFBE0DF;
const SOON_FILL: u32 = 0xFDEFCF;

type Result<T> = std::result::Result<T, AppError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    /// Period for the inspections list, both days included.
    from: String,
    to: String,
    /// How far ahead the expiring list looks.
    expiring_days: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedRow {
    inspection_id: i64,
    date: String,
    car_id: i64,
    plate: String,
    manufacturer: String,
    model: String,
    /// Who brought the car, when known.
    phone: Option<String>,
    next_revision: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueRow {
    car_id: i64,
    plate: String,
    manufacturer: String,
    model: String,
    last_revision: String,
    next_revision: String,
    /// Days left until the next inspection, or days since it expired.
    days: i64,
    phones: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatCar {
    car_id: i64,
    plate: String,
    manufacturer: String,
    model: String,
    visits: i64,
    first_visit: String,
    last_visit: String,
    phones: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeatClient {
    client_id: i64,
    phone: String,
    visits: i64,
    plates: String,
    last_visit: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    generated_at: String,
    inspected: Vec<InspectedRow>,
    expiring: Vec<DueRow>,
    expired: Vec<DueRow>,
    repeat_cars: Vec<RepeatCar>,
    repeat_clients: Vec<RepeatClient>,
}

fn validate(conn: &Connection, request: &ReportRequest) -> Result<()> {
    let dates_valid = data::has_format(conn, "%Y-%m-%d", &request.from)?
        && data::has_format(conn, "%Y-%m-%d", &request.to)?
        && request.from <= request.to;
    if !dates_valid {
        return Err(AppError::code("invalid_date"));
    }
    if !(1..=MAX_EXPIRING_DAYS).contains(&request.expiring_days) {
        return Err(AppError::code("invalid_days"));
    }
    Ok(())
}

/// Every phone linked to the car, in one cell.
const CAR_PHONES: &str = "COALESCE((SELECT group_concat(Phone, ', ') FROM (
        SELECT cl.Phone FROM carsclients l JOIN clients cl ON cl.ClientID = l.ClientID
        WHERE l.CarID = c.CarID ORDER BY cl.Phone)), '')";

fn inspected(conn: &Connection, request: &ReportRequest) -> Result<Vec<InspectedRow>> {
    let sql = format!(
        "SELECT i.InspectionID, i.Date, c.CarID, c.Plate, c.Manufacturer, c.Model, cl.Phone,
                {next}
         FROM inspections i
         JOIN cars c ON c.CarID = i.CarID
         LEFT JOIN clients cl ON cl.ClientID = i.ClientID
         WHERE i.Date BETWEEN ?1 AND ?2
         ORDER BY i.Date DESC, c.Plate",
        next = data::NEXT_REVISION,
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![request.from, request.to], |row| {
        Ok(InspectedRow {
            inspection_id: row.get(0)?,
            date: row.get(1)?,
            car_id: row.get(2)?,
            plate: row.get(3)?,
            manufacturer: row.get(4)?,
            model: row.get(5)?,
            phone: row.get(6)?,
            next_revision: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn due_from_row(row: &Row) -> rusqlite::Result<DueRow> {
    Ok(DueRow {
        car_id: row.get(0)?,
        plate: row.get(1)?,
        manufacturer: row.get(2)?,
        model: row.get(3)?,
        last_revision: row.get(4)?,
        next_revision: row.get(5)?,
        days: row.get(6)?,
        phones: row.get(7)?,
    })
}

/// Cars whose `next_revision` matches `condition`, soonest first. `days` is the distance
/// from today, always positive.
fn due(conn: &Connection, condition: &str, days: &str, values: &[&dyn rusqlite::ToSql]) -> Result<Vec<DueRow>> {
    let sql = format!(
        "SELECT CarID, Plate, Manufacturer, Model, LastRevision, next_revision, {days}, phones
         FROM (
             SELECT c.CarID, c.Plate, c.Manufacturer, c.Model, c.LastRevision,
                    {next} AS next_revision, {CAR_PHONES} AS phones
             FROM cars c WHERE c.LastRevision IS NOT NULL
         )
         WHERE {condition}
         ORDER BY next_revision, Plate",
        next = data::NEXT_REVISION,
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(values, due_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn expiring(conn: &Connection, today: &str, days: i64) -> Result<Vec<DueRow>> {
    due(
        conn,
        "next_revision BETWEEN ?1 AND date(?1, '+' || ?2 || ' days')",
        "CAST(julianday(next_revision) - julianday(?1) AS INTEGER)",
        &[&today, &days],
    )
}

fn expired(conn: &Connection, today: &str) -> Result<Vec<DueRow>> {
    due(
        conn,
        "next_revision < ?1",
        "CAST(julianday(?1) - julianday(next_revision) AS INTEGER)",
        &[&today],
    )
}

/// Cars inspected more than once, over all time.
fn repeat_cars(conn: &Connection) -> Result<Vec<RepeatCar>> {
    let sql = format!(
        "SELECT c.CarID, c.Plate, c.Manufacturer, c.Model, v.visits, v.first_visit, v.last_visit,
                {CAR_PHONES}
         FROM (SELECT CarID, COUNT(*) AS visits, MIN(Date) AS first_visit, MAX(Date) AS last_visit
               FROM inspections GROUP BY CarID HAVING COUNT(*) > 1) v
         JOIN cars c ON c.CarID = v.CarID
         ORDER BY v.visits DESC, v.last_visit DESC, c.Plate"
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map([], |row| {
        Ok(RepeatCar {
            car_id: row.get(0)?,
            plate: row.get(1)?,
            manufacturer: row.get(2)?,
            model: row.get(3)?,
            visits: row.get(4)?,
            first_visit: row.get(5)?,
            last_visit: row.get(6)?,
            phones: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Clients who brought a car more than once, with any of their cars, over all time.
fn repeat_clients(conn: &Connection) -> Result<Vec<RepeatClient>> {
    let mut statement = conn.prepare(
        "SELECT cl.ClientID, cl.Phone, COUNT(*) AS visits,
                (SELECT group_concat(Plate, ', ') FROM (
                    SELECT DISTINCT c.Plate FROM inspections j JOIN cars c ON c.CarID = j.CarID
                    WHERE j.ClientID = cl.ClientID ORDER BY c.Plate)),
                MAX(i.Date) AS last_visit
         FROM inspections i
         JOIN clients cl ON cl.ClientID = i.ClientID
         GROUP BY cl.ClientID HAVING COUNT(*) > 1
         ORDER BY visits DESC, last_visit DESC, cl.Phone",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(RepeatClient {
            client_id: row.get(0)?,
            phone: row.get(1)?,
            visits: row.get(2)?,
            plates: row.get(3)?,
            last_visit: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn build(conn: &Connection, request: &ReportRequest) -> Result<Report> {
    validate(conn, request)?;
    let (today, now): (String, String) = conn.query_row(
        "SELECT date('now', 'localtime'), strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    build_on(conn, request, &today, now)
}

fn build_on(conn: &Connection, request: &ReportRequest, today: &str, now: String) -> Result<Report> {
    Ok(Report {
        inspected: inspected(conn, request)?,
        expiring: expiring(conn, today, request.expiring_days)?,
        expired: expired(conn, today)?,
        repeat_cars: repeat_cars(conn)?,
        repeat_clients: repeat_clients(conn)?,
        generated_at: now,
    })
}

/// Sheet text, supplied by the frontend so all wording stays in the locale files.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLabels {
    sheet_inspected: String,
    sheet_expiring: String,
    sheet_expired: String,
    sheet_repeat_cars: String,
    sheet_repeat_clients: String,
    date: String,
    plate: String,
    manufacturer: String,
    model: String,
    brought_by: String,
    phone: String,
    phones: String,
    last_revision: String,
    next_revision: String,
    days_left: String,
    days_overdue: String,
    visits: String,
    first_visit: String,
    last_visit: String,
    plates: String,
}

struct Formats {
    header: Format,
    date: Format,
    number: Format,
}

impl Formats {
    fn new() -> Self {
        Self {
            header: Format::new()
                .set_bold()
                .set_background_color(Color::RGB(HEADER_FILL))
                .set_border_bottom(FormatBorder::Thin),
            date: Format::new().set_num_format("dd.mm.yyyy").set_align(FormatAlign::Left),
            number: Format::new().set_align(FormatAlign::Left),
        }
    }
}

fn excel_date(text: &str) -> std::result::Result<ExcelDateTime, XlsxError> {
    ExcelDateTime::parse_from_str(text)
}

/// Header row, widths, frozen header, filter and print setup.
fn start_sheet(
    sheet: &mut Worksheet,
    columns: &[(&str, f64)],
    rows: usize,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    for (column, (title, width)) in columns.iter().enumerate() {
        sheet.write_string_with_format(0, column as u16, *title, &formats.header)?;
        sheet.set_column_width(column as u16, *width)?;
    }
    sheet.set_freeze_panes(1, 0)?;
    sheet.set_landscape();
    sheet.set_print_fit_to_pages(1, 0);
    sheet.set_repeat_rows(0, 0)?;
    if rows > 0 {
        sheet.autofilter(0, 0, rows as u32, columns.len() as u16 - 1)?;
    }
    Ok(())
}

fn write_date(
    sheet: &mut Worksheet,
    row: u32,
    column: u16,
    value: Option<&str>,
    format: &Format,
) -> std::result::Result<(), XlsxError> {
    if let Some(value) = value {
        sheet.write_datetime_with_format(row, column, excel_date(value)?, format)?;
    }
    Ok(())
}

fn write_inspected(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let columns = [
        (labels.date.as_str(), 13.0),
        (&labels.plate, 13.0),
        (&labels.manufacturer, 16.0),
        (&labels.model, 16.0),
        (&labels.brought_by, 18.0),
        (&labels.next_revision, 22.0),
    ];
    start_sheet(sheet, &columns, report.inspected.len(), formats)?;
    for (index, item) in report.inspected.iter().enumerate() {
        let row = index as u32 + 1;
        write_date(sheet, row, 0, Some(&item.date), &formats.date)?;
        sheet.write_string(row, 1, &item.plate)?;
        sheet.write_string(row, 2, &item.manufacturer)?;
        sheet.write_string(row, 3, &item.model)?;
        sheet.write_string(row, 4, item.phone.as_deref().unwrap_or("-"))?;
        write_date(sheet, row, 5, item.next_revision.as_deref(), &formats.date)?;
    }
    Ok(())
}

fn write_due(
    sheet: &mut Worksheet,
    rows: &[DueRow],
    days_title: &str,
    fill: u32,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let columns = [
        (labels.plate.as_str(), 13.0),
        (&labels.manufacturer, 16.0),
        (&labels.model, 16.0),
        (&labels.last_revision, 18.0),
        (&labels.next_revision, 22.0),
        (days_title, 16.0),
        (&labels.phones, 34.0),
    ];
    start_sheet(sheet, &columns, rows.len(), formats)?;
    // A coloured date keeps the urgency visible when printed in black and white too.
    let next_format = formats.date.clone().set_background_color(Color::RGB(fill));
    for (index, car) in rows.iter().enumerate() {
        let row = index as u32 + 1;
        sheet.write_string(row, 0, &car.plate)?;
        sheet.write_string(row, 1, &car.manufacturer)?;
        sheet.write_string(row, 2, &car.model)?;
        write_date(sheet, row, 3, Some(&car.last_revision), &formats.date)?;
        write_date(sheet, row, 4, Some(&car.next_revision), &next_format)?;
        sheet.write_number_with_format(row, 5, car.days as f64, &formats.number)?;
        sheet.write_string(row, 6, &car.phones)?;
    }
    Ok(())
}

fn write_repeat_cars(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let columns = [
        (labels.plate.as_str(), 13.0),
        (&labels.manufacturer, 16.0),
        (&labels.model, 16.0),
        (&labels.visits, 12.0),
        (&labels.first_visit, 16.0),
        (&labels.last_visit, 16.0),
        (&labels.phones, 34.0),
    ];
    start_sheet(sheet, &columns, report.repeat_cars.len(), formats)?;
    for (index, car) in report.repeat_cars.iter().enumerate() {
        let row = index as u32 + 1;
        sheet.write_string(row, 0, &car.plate)?;
        sheet.write_string(row, 1, &car.manufacturer)?;
        sheet.write_string(row, 2, &car.model)?;
        sheet.write_number_with_format(row, 3, car.visits as f64, &formats.number)?;
        write_date(sheet, row, 4, Some(&car.first_visit), &formats.date)?;
        write_date(sheet, row, 5, Some(&car.last_visit), &formats.date)?;
        sheet.write_string(row, 6, &car.phones)?;
    }
    Ok(())
}

fn write_repeat_clients(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let columns = [
        (labels.phone.as_str(), 16.0),
        (&labels.visits, 12.0),
        (&labels.plates, 34.0),
        (&labels.last_visit, 16.0),
    ];
    start_sheet(sheet, &columns, report.repeat_clients.len(), formats)?;
    for (index, client) in report.repeat_clients.iter().enumerate() {
        let row = index as u32 + 1;
        sheet.write_string(row, 0, &client.phone)?;
        sheet.write_number_with_format(row, 1, client.visits as f64, &formats.number)?;
        sheet.write_string(row, 2, &client.plates)?;
        write_date(sheet, row, 3, Some(&client.last_visit), &formats.date)?;
    }
    Ok(())
}

pub fn workbook_bytes(report: &Report, labels: &ExportLabels) -> std::result::Result<Vec<u8>, XlsxError> {
    let formats = Formats::new();
    let mut workbook = Workbook::new();

    let sheet = workbook.add_worksheet().set_name(&labels.sheet_inspected)?;
    write_inspected(sheet, report, labels, &formats)?;
    let sheet = workbook.add_worksheet().set_name(&labels.sheet_expiring)?;
    write_due(sheet, &report.expiring, &labels.days_left, SOON_FILL, labels, &formats)?;
    let sheet = workbook.add_worksheet().set_name(&labels.sheet_expired)?;
    write_due(sheet, &report.expired, &labels.days_overdue, OVER_FILL, labels, &formats)?;
    let sheet = workbook.add_worksheet().set_name(&labels.sheet_repeat_cars)?;
    write_repeat_cars(sheet, report, labels, &formats)?;
    let sheet = workbook.add_worksheet().set_name(&labels.sheet_repeat_clients)?;
    write_repeat_clients(sheet, report, labels, &formats)?;

    workbook.save_to_buffer()
}

/// Writes the file, adding the extension if the save dialog left it out.
pub fn save_workbook(mut path: PathBuf, bytes: &[u8]) -> Result<String> {
    if path.extension().is_none() {
        path.set_extension("xlsx");
    }
    fs::write(&path, bytes).map_err(|error| {
        // On Windows this usually means the file is still open in Excel.
        eprintln!("could not save report: {error}");
        AppError::code("report_save_failed")
    })?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    const TODAY: &str = "2030-06-15";

    fn request(from: &str, to: &str, expiring_days: i64) -> ReportRequest {
        ReportRequest { from: from.into(), to: to.into(), expiring_days }
    }

    fn report(conn: &Connection, request: &ReportRequest) -> Report {
        validate(conn, request).unwrap();
        build_on(conn, request, TODAY, format!("{TODAY}T12:00")).unwrap()
    }

    fn add_car(conn: &Connection, plate: &str, last: Option<&str>, months: i64) -> i64 {
        conn.execute(
            "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency)
             VALUES (?1, 'Dacia', 'Logan', ?2, ?3)",
            params![plate, last, months],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn add_client(conn: &Connection, phone: &str, car: Option<i64>) -> i64 {
        conn.execute("INSERT INTO clients (Phone) VALUES (?1)", params![phone]).unwrap();
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

    fn plates(rows: &[DueRow]) -> Vec<(&str, i64)> {
        rows.iter().map(|car| (car.plate.as_str(), car.days)).collect()
    }

    #[test]
    fn inspections_list_both_end_days_newest_first() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2030-06-01"), 12);
        let client = add_client(&conn, "0722000000", Some(car));
        for date in ["2030-05-31", "2030-06-01", "2030-06-10", "2030-06-11"] {
            inspect(&conn, Some(client), car, date);
        }
        let other = add_car(&conn, "B2AAA", None, 12);
        inspect(&conn, None, other, "2030-06-05");

        let found = report(&conn, &request("2030-06-01", "2030-06-10", 30));

        let rows: Vec<(&str, &str, Option<&str>)> = found
            .inspected
            .iter()
            .map(|row| (row.date.as_str(), row.plate.as_str(), row.phone.as_deref()))
            .collect();
        assert_eq!(
            rows,
            [
                ("2030-06-10", "B1AAA", Some("0722000000")),
                ("2030-06-05", "B2AAA", None),
                ("2030-06-01", "B1AAA", Some("0722000000")),
            ]
        );
    }

    #[test]
    fn expiring_uses_the_chosen_days_and_expired_holds_the_rest() {
        let conn = test_connection();
        // Next inspections: 2030-06-14, 2030-06-15, 2030-07-15, 2030-12-12 and 2030-12-13.
        add_car(&conn, "B1PAST", Some("2029-06-14"), 12);
        add_car(&conn, "B2TODAY", Some("2029-06-15"), 12);
        add_car(&conn, "B3MONTH", Some("2029-07-15"), 12);
        add_car(&conn, "B4HALF", Some("2029-12-12"), 12);
        add_car(&conn, "B5LATER", Some("2029-12-13"), 12);
        add_car(&conn, "B6NONE", None, 12);

        let month = report(&conn, &request(TODAY, TODAY, 30));
        assert_eq!(plates(&month.expiring), [("B2TODAY", 0), ("B3MONTH", 30)]);
        assert_eq!(plates(&month.expired), [("B1PAST", 1)]);

        let half_year = report(&conn, &request(TODAY, TODAY, MAX_EXPIRING_DAYS));
        assert_eq!(
            plates(&half_year.expiring),
            [("B2TODAY", 0), ("B3MONTH", 30), ("B4HALF", 180)]
        );
    }

    #[test]
    fn a_car_with_several_clients_is_one_row() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2029-01-01"), 12);
        add_client(&conn, "0733000000", Some(car));
        add_client(&conn, "0722000000", Some(car));

        let found = report(&conn, &request(TODAY, TODAY, 30));

        assert_eq!(found.expired.len(), 1);
        assert_eq!(found.expired[0].phones, "0722000000, 0733000000");
    }

    #[test]
    fn repeat_lists_count_every_visit_ever() {
        let conn = test_connection();
        let twice = add_car(&conn, "B1AAA", Some("2030-01-01"), 12);
        let once = add_car(&conn, "B2AAA", Some("2030-01-01"), 12);
        let other = add_car(&conn, "B3AAA", Some("2030-01-01"), 12);
        let regular = add_client(&conn, "0722000000", Some(twice));
        let new = add_client(&conn, "0733000000", Some(once));
        inspect(&conn, Some(regular), twice, "2020-01-01");
        inspect(&conn, Some(regular), twice, "2030-01-01");
        inspect(&conn, Some(new), once, "2030-01-01");
        // A client counts visits with any car.
        inspect(&conn, Some(new), other, "2025-01-01");
        inspect(&conn, None, other, "2030-01-01");

        let found = report(&conn, &request(TODAY, TODAY, 30));

        let cars: Vec<(&str, i64, &str, &str)> = found
            .repeat_cars
            .iter()
            .map(|car| (car.plate.as_str(), car.visits, car.first_visit.as_str(), car.last_visit.as_str()))
            .collect();
        assert_eq!(
            cars,
            [("B1AAA", 2, "2020-01-01", "2030-01-01"), ("B3AAA", 2, "2025-01-01", "2030-01-01")]
        );
        let clients: Vec<(&str, i64, &str)> = found
            .repeat_clients
            .iter()
            .map(|client| (client.phone.as_str(), client.visits, client.plates.as_str()))
            .collect();
        assert_eq!(clients, [("0722000000", 2, "B1AAA"), ("0733000000", 2, "B2AAA, B3AAA")]);
    }

    #[test]
    fn rejects_bad_dates_and_days() {
        let conn = test_connection();
        let invalid_date = Some(AppError::code("invalid_date"));
        let invalid_days = Some(AppError::code("invalid_days"));
        assert_eq!(build(&conn, &request("2030-02-30", "2030-03-01", 30)).err(), invalid_date);
        assert_eq!(build(&conn, &request("2030-02-02", "2030-02-01", 30)).err(), invalid_date);
        assert_eq!(build(&conn, &request("2030-01-01", "2030-01-01", 0)).err(), invalid_days);
        assert_eq!(build(&conn, &request("2030-01-01", "2030-01-01", 181)).err(), invalid_days);
        assert!(build(&conn, &request("2020-01-01", "2031-01-01", 180)).is_ok());
    }

    fn labels() -> ExportLabels {
        let text = |value: &str| value.to_string();
        ExportLabels {
            sheet_inspected: text("Inspected"),
            sheet_expiring: text("Expiring"),
            sheet_expired: text("Expired"),
            sheet_repeat_cars: text("Repeat cars"),
            sheet_repeat_clients: text("Repeat clients"),
            date: text("date"),
            plate: text("plate"),
            manufacturer: text("manufacturer"),
            model: text("model"),
            brought_by: text("brought by"),
            phone: text("phone"),
            phones: text("phones"),
            last_revision: text("last"),
            next_revision: text("next"),
            days_left: text("days left"),
            days_overdue: text("days overdue"),
            visits: text("visits"),
            first_visit: text("first"),
            last_visit: text("last visit"),
            plates: text("plates"),
        }
    }

    #[test]
    fn workbook_is_written_with_and_without_data() {
        let conn = test_connection();
        let range = request("2030-01-01", TODAY, 30);
        let empty = report(&conn, &range);
        assert!(workbook_bytes(&empty, &labels()).unwrap().starts_with(b"PK"));

        let car = add_car(&conn, "B1AAA", Some("2029-06-20"), 12);
        let client = add_client(&conn, "0722000000", Some(car));
        inspect(&conn, Some(client), car, "2028-06-20");
        inspect(&conn, Some(client), car, "2029-06-20");
        add_car(&conn, "B2AAA", Some("2029-01-01"), 12);
        let full = report(&conn, &request("2028-01-01", TODAY, 30));
        assert!(!full.inspected.is_empty() && !full.expiring.is_empty() && !full.expired.is_empty());
        assert!(workbook_bytes(&full, &labels()).unwrap().starts_with(b"PK"));
    }

    #[test]
    fn saving_adds_the_missing_extension() {
        let directory = tempfile::tempdir().unwrap();
        let saved = save_workbook(directory.path().join("raport"), b"PK").unwrap();
        assert!(saved.ends_with("raport.xlsx"));
        assert!(fs::metadata(&saved).is_ok());
    }

    #[test]
    fn a_blocked_file_reports_a_save_error() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("missing").join("raport.xlsx");
        assert_eq!(save_workbook(missing, b"PK").err(), Some(AppError::code("report_save_failed")));
    }
}
