//! Figures behind the Reports page and its .xlsx export.

use std::fs;
use std::path::PathBuf;

use rusqlite::{Connection, Row, params};
use rust_xlsxwriter::{
    Chart, ChartLine, ChartMarker, ChartMarkerType, ChartPoint, ChartSolidFill, ChartType, Color, ExcelDateTime, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError,
};
use serde::{Deserialize, Serialize};

use crate::data::{self, AppError};

const MAX_RANGE_DAYS: i64 = 366;
const CHART_BLUE: u32 = 0x2A78D6;
const CHART_RED: u32 = 0xD03B3B;
const CAPACITY_GREY: u32 = 0x52514E;
const CAPACITY_MARKER_SIZE: u8 = 12;
/// Up to this many appointments a day, the chart axis counts in whole numbers.
const WHOLE_UNIT_AXIS_LIMIT: i64 = 10;
const OVER_FILL: u32 = 0xFBE0DF;
const SOON_FILL: u32 = 0xFDEFCF;
const MUTED_FILL: u32 = 0xEEEEEA;

type Result<T> = std::result::Result<T, AppError>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRequest {
    from: String,
    to: String,
    /// 0 is Monday.
    working_days: Vec<i64>,
    start_hour: i64,
    end_hour: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    appointments: i64,
    completed: i64,
    past: i64,
    /// Share of past appointments that are done, or none if nothing has passed yet.
    completion_rate: Option<f64>,
    booked_minutes: i64,
    overdue_cars: i64,
    messages_sent: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRow {
    appointment_id: i64,
    date: String,
    time: String,
    duration: i64,
    plate: String,
    manufacturer: String,
    model: String,
    phone: String,
    is_done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRow {
    date: String,
    weekday: i64,
    appointments: i64,
    booked_minutes: i64,
    capacity_minutes: i64,
    overbooked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueRow {
    car_id: i64,
    state: String,
    plate: String,
    manufacturer: String,
    model: String,
    last_revision: Option<String>,
    next_revision: Option<String>,
    phones: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    generated_at: String,
    overview: Overview,
    schedule: Vec<ScheduleRow>,
    load: Vec<LoadRow>,
    due: Vec<DueRow>,
}

fn validate(conn: &Connection, request: &ReportRequest) -> Result<()> {
    let dates_valid = data::has_format(conn, "%Y-%m-%d", &request.from)?
        && data::has_format(conn, "%Y-%m-%d", &request.to)?
        && request.from <= request.to;
    let hours_valid =
        (0..=24).contains(&request.start_hour)
            && (0..=24).contains(&request.end_hour)
            && request.start_hour < request.end_hour;
    if !dates_valid || !hours_valid {
        return Err(AppError::code("invalid_date"));
    }

    let days: i64 = conn.query_row(
        "SELECT CAST(julianday(?2) - julianday(?1) AS INTEGER) + 1",
        params![request.from, request.to],
        |row| row.get(0),
    )?;
    if days > MAX_RANGE_DAYS {
        return Err(AppError::code("report_range_too_long"));
    }
    Ok(())
}

fn schedule(conn: &Connection, request: &ReportRequest) -> Result<Vec<ScheduleRow>> {
    let mut statement = conn.prepare(
        "SELECT a.AppointmentID, substr(a.TimeDate, 1, 10), substr(a.TimeDate, 12, 5), a.Duration,
                c.Plate, c.Manufacturer, c.Model, cl.Phone, a.IsDone
         FROM appointments a
         JOIN cars c ON c.CarID = a.CarID
         JOIN clients cl ON cl.ClientID = a.ClientID
         WHERE substr(a.TimeDate, 1, 10) BETWEEN ?1 AND ?2
         ORDER BY a.TimeDate, c.Plate",
    )?;
    let rows = statement.query_map(params![request.from, request.to], |row| {
        Ok(ScheduleRow {
            appointment_id: row.get(0)?,
            date: row.get(1)?,
            time: row.get(2)?,
            duration: row.get(3)?,
            plate: row.get(4)?,
            manufacturer: row.get(5)?,
            model: row.get(6)?,
            phone: row.get(7)?,
            is_done: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// One row per working day, plus any other day that has bookings.
fn load(conn: &Connection, request: &ReportRequest) -> Result<Vec<LoadRow>> {
    let mut statement = conn.prepare(
        "WITH RECURSIVE days(day) AS (
             SELECT ?1 UNION ALL SELECT date(day, '+1 day') FROM days WHERE day < ?2
         )
         SELECT d.day, (CAST(strftime('%w', d.day) AS INTEGER) + 6) % 7,
                COUNT(a.AppointmentID), COALESCE(SUM(a.Duration), 0)
         FROM days d
         LEFT JOIN appointments a ON substr(a.TimeDate, 1, 10) = d.day
         GROUP BY d.day
         ORDER BY d.day",
    )?;
    let open_minutes = (request.end_hour - request.start_hour) * 60;
    let rows = statement.query_map(params![request.from, request.to], |row| {
        let weekday: i64 = row.get(1)?;
        let booked_minutes: i64 = row.get(3)?;
        let capacity_minutes = if request.working_days.contains(&weekday) { open_minutes } else { 0 };
        Ok(LoadRow {
            date: row.get(0)?,
            weekday,
            appointments: row.get(2)?,
            booked_minutes,
            capacity_minutes,
            overbooked: booked_minutes > capacity_minutes,
        })
    })?;
    let all = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(all
        .into_iter()
        .filter(|row| row.capacity_minutes > 0 || row.booked_minutes > 0)
        .collect())
}

fn due_from_row(row: &Row) -> rusqlite::Result<DueRow> {
    Ok(DueRow {
        car_id: row.get(0)?,
        state: row.get(1)?,
        plate: row.get(2)?,
        manufacturer: row.get(3)?,
        model: row.get(4)?,
        last_revision: row.get(5)?,
        next_revision: row.get(6)?,
        phones: row.get(7)?,
    })
}

/// Cars to contact: overdue, due soon or unknown, unless already booked.
fn due(conn: &Connection, now: &str) -> Result<Vec<DueRow>> {
    let sql = format!(
        "SELECT * FROM (
             SELECT c.CarID, {state} AS state, c.Plate, c.Manufacturer, c.Model, c.LastRevision,
                    {next} AS next_revision,
                    COALESCE((SELECT group_concat(Phone, ', ') FROM (
                        SELECT cl.Phone FROM carsclients l
                        JOIN clients cl ON cl.ClientID = l.ClientID
                        WHERE l.CarID = c.CarID ORDER BY cl.Phone
                    )), '') AS phones
             FROM cars c
             WHERE NOT EXISTS (
                 SELECT 1 FROM appointments a
                 WHERE a.CarID = c.CarID AND a.IsDone = 0 AND a.TimeDate >= ?1
             )
         )
         WHERE state IN ('overdue', 'soon', 'unknown')
         ORDER BY CASE state WHEN 'overdue' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END,
                  next_revision, Plate",
        state = data::revision_state_sql(),
        next = data::NEXT_REVISION,
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![now], due_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn build(conn: &Connection, request: &ReportRequest) -> Result<Report> {
    validate(conn, request)?;

    let now: String =
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')", [], |row| row.get(0))?;
    let due = due(conn, &now)?;

    let (appointments, past, completed, booked_minutes): (i64, i64, i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(TimeDate < ?3), 0),
                COALESCE(SUM(TimeDate < ?3 AND IsDone), 0),
                COALESCE(SUM(Duration), 0)
         FROM appointments WHERE substr(TimeDate, 1, 10) BETWEEN ?1 AND ?2",
        params![request.from, request.to, now],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;

    let messages_sent: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages
         WHERE Status = 'sent' AND substr(SentAt, 1, 10) BETWEEN ?1 AND ?2",
        params![request.from, request.to],
        |row| row.get(0),
    )?;

    Ok(Report {
        overview: Overview {
            appointments,
            completed,
            past,
            completion_rate: (past > 0).then(|| completed as f64 / past as f64),
            booked_minutes,
            overdue_cars: due.iter().filter(|row| row.state == "overdue").count() as i64,
            messages_sent,
        },
        schedule: schedule(conn, request)?,
        load: load(conn, request)?,
        due,
        generated_at: now,
    })
}

/// Sheet text, supplied by the frontend so all wording stays in the locale files.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLabels {
    sheet_overview: String,
    sheet_schedule: String,
    sheet_load: String,
    sheet_due: String,
    title: String,
    period: String,
    generated_at: String,
    appointments: String,
    completed_of_past: String,
    completion_rate: String,
    overdue_cars: String,
    messages_sent: String,
    booked_hours: String,
    appointments_per_day: String,
    booked_per_day: String,
    date: String,
    weekday: String,
    time: String,
    duration_minutes: String,
    plate: String,
    manufacturer: String,
    model: String,
    phone: String,
    done: String,
    yes: String,
    no: String,
    working_hours: String,
    load_percent: String,
    status: String,
    overbooked: String,
    within_capacity: String,
    state_label: DueStateLabels,
    last_revision: String,
    next_revision: String,
    phones: String,
    weekdays: Vec<String>,
}

#[derive(Deserialize)]
struct DueStateLabels {
    overdue: String,
    soon: String,
    unknown: String,
}

impl DueStateLabels {
    fn of(&self, state: &str) -> &str {
        match state {
            "overdue" => &self.overdue,
            "soon" => &self.soon,
            _ => &self.unknown,
        }
    }
}

struct Formats {
    header: Format,
    title: Format,
    label: Format,
    date: Format,
    time: Format,
    percent: Format,
    hours: Format,
    group_date: Format,
    group_text: Format,
}

impl Formats {
    fn new() -> Self {
        let group = Format::new().set_bold().set_background_color(Color::RGB(MUTED_FILL));
        Self {
            header: Format::new()
                .set_bold()
                .set_background_color(Color::RGB(MUTED_FILL))
                .set_border_bottom(FormatBorder::Thin),
            title: Format::new().set_bold().set_font_size(16),
            label: Format::new().set_bold(),
            date: Format::new().set_num_format("dd.mm.yyyy").set_align(FormatAlign::Left),
            time: Format::new().set_num_format("hh:mm").set_align(FormatAlign::Left),
            percent: Format::new().set_num_format("0%").set_align(FormatAlign::Left),
            hours: Format::new().set_num_format("0.0").set_align(FormatAlign::Left),
            group_date: group
                .clone()
                .set_num_format("dd.mm.yyyy")
                .set_align(FormatAlign::Left),
            group_text: group,
        }
    }
}

fn excel_date(text: &str) -> std::result::Result<ExcelDateTime, XlsxError> {
    ExcelDateTime::parse_from_str(text)
}

fn display_date(iso: &str) -> String {
    let parts: Vec<&str> = iso.split('-').collect();
    match parts.as_slice() {
        [year, month, day] => format!("{day}.{month}.{year}"),
        _ => iso.to_string(),
    }
}

fn hours(minutes: i64) -> f64 {
    minutes as f64 / 60.0
}

fn write_headers(
    sheet: &mut Worksheet,
    titles: &[&str],
    widths: &[f64],
    format: &Format,
) -> std::result::Result<(), XlsxError> {
    for (column, (title, width)) in titles.iter().zip(widths).enumerate() {
        sheet.write_string_with_format(0, column as u16, *title, format)?;
        sheet.set_column_width(column as u16, *width)?;
    }
    sheet.set_freeze_panes(1, 0)?;
    sheet.set_landscape();
    sheet.set_print_fit_to_pages(1, 0);
    sheet.set_repeat_rows(0, 0)?;
    Ok(())
}

fn write_schedule(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let titles = [
        labels.date.as_str(),
        &labels.time,
        &labels.duration_minutes,
        &labels.plate,
        &labels.manufacturer,
        &labels.model,
        &labels.phone,
        &labels.done,
    ];
    write_headers(sheet, &titles, &[13.0, 13.0, 14.0, 13.0, 16.0, 16.0, 15.0, 11.0], &formats.header)?;

    let mut row = 1;
    let mut current_day: Option<&str> = None;
    for item in &report.schedule {
        if current_day != Some(item.date.as_str()) {
            current_day = Some(&item.date);
            sheet.write_datetime_with_format(row, 0, excel_date(&item.date)?, &formats.group_date)?;
            let weekday = report
                .load
                .iter()
                .find(|day| day.date == item.date)
                .and_then(|day| labels.weekdays.get(day.weekday as usize))
                .map_or("", String::as_str);
            sheet.write_string_with_format(row, 1, weekday, &formats.group_text)?;
            for column in 2..titles.len() as u16 {
                sheet.write_blank(row, column, &formats.group_text)?;
            }
            row += 1;
        }
        sheet.write_datetime_with_format(row, 0, excel_date(&item.date)?, &formats.date)?;
        sheet.write_datetime_with_format(row, 1, excel_date(&item.time)?, &formats.time)?;
        sheet.write_number(row, 2, item.duration as f64)?;
        sheet.write_string(row, 3, &item.plate)?;
        sheet.write_string(row, 4, &item.manufacturer)?;
        sheet.write_string(row, 5, &item.model)?;
        sheet.write_string(row, 6, &item.phone)?;
        sheet.write_string(row, 7, if item.is_done { &labels.yes } else { &labels.no })?;
        row += 1;
    }
    if row > 1 {
        sheet.autofilter(0, 0, row - 1, titles.len() as u16 - 1)?;
    }
    Ok(())
}

const LOAD_COLUMN_APPOINTMENTS: u16 = 2;
const LOAD_COLUMN_BOOKED: u16 = 3;
const LOAD_COLUMN_CAPACITY: u16 = 4;

fn write_load(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let titles = [
        labels.date.as_str(),
        &labels.weekday,
        &labels.appointments,
        &labels.booked_hours,
        &labels.working_hours,
        &labels.load_percent,
        &labels.status,
    ];
    write_headers(sheet, &titles, &[13.0, 13.0, 13.0, 16.0, 13.0, 19.0, 18.0], &formats.header)?;

    for (index, day) in report.load.iter().enumerate() {
        let row = index as u32 + 1;
        // Marking the row keeps overbooked days visible when printed in black and white.
        let fill = |format: &Format| {
            if day.overbooked {
                format.clone().set_background_color(Color::RGB(OVER_FILL))
            } else {
                format.clone()
            }
        };
        let plain = fill(&Format::new().set_align(FormatAlign::Left));
        sheet.write_datetime_with_format(row, 0, excel_date(&day.date)?, &fill(&formats.date))?;
        let weekday = labels.weekdays.get(day.weekday as usize).map_or("", String::as_str);
        sheet.write_string_with_format(row, 1, weekday, &plain)?;
        sheet.write_number_with_format(row, LOAD_COLUMN_APPOINTMENTS, day.appointments as f64, &plain)?;
        sheet.write_number_with_format(row, LOAD_COLUMN_BOOKED, hours(day.booked_minutes), &fill(&formats.hours))?;
        sheet.write_number_with_format(row, LOAD_COLUMN_CAPACITY, hours(day.capacity_minutes), &fill(&formats.hours))?;
        if day.capacity_minutes > 0 {
            let share = day.booked_minutes as f64 / day.capacity_minutes as f64;
            sheet.write_number_with_format(row, 5, share, &fill(&formats.percent))?;
        } else {
            sheet.write_string_with_format(row, 5, "-", &plain)?;
        }
        let status = if day.overbooked { &labels.overbooked } else { &labels.within_capacity };
        sheet.write_string_with_format(row, 6, status, &plain)?;
    }
    Ok(())
}

fn write_due(
    sheet: &mut Worksheet,
    report: &Report,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let titles = [
        labels.status.as_str(),
        &labels.plate,
        &labels.manufacturer,
        &labels.model,
        &labels.last_revision,
        &labels.next_revision,
        &labels.phones,
    ];
    write_headers(sheet, &titles, &[16.0, 13.0, 16.0, 16.0, 18.0, 22.0, 34.0], &formats.header)?;

    for (index, car) in report.due.iter().enumerate() {
        let row = index as u32 + 1;
        let status = match car.state.as_str() {
            "overdue" => Format::new().set_background_color(Color::RGB(OVER_FILL)),
            "soon" => Format::new().set_background_color(Color::RGB(SOON_FILL)),
            _ => Format::new().set_background_color(Color::RGB(MUTED_FILL)),
        };
        sheet.write_string_with_format(row, 0, labels.state_label.of(&car.state), &status)?;
        sheet.write_string(row, 1, &car.plate)?;
        sheet.write_string(row, 2, &car.manufacturer)?;
        sheet.write_string(row, 3, &car.model)?;
        if let Some(last) = &car.last_revision {
            sheet.write_datetime_with_format(row, 4, excel_date(last)?, &formats.date)?;
        }
        if let Some(next) = &car.next_revision {
            sheet.write_datetime_with_format(row, 5, excel_date(next)?, &formats.date)?;
        }
        sheet.write_string(row, 6, &car.phones)?;
    }
    if !report.due.is_empty() {
        sheet.autofilter(0, 0, report.due.len() as u32, titles.len() as u16 - 1)?;
    }
    Ok(())
}

fn write_overview(
    sheet: &mut Worksheet,
    report: &Report,
    request: &ReportRequest,
    labels: &ExportLabels,
    formats: &Formats,
) -> std::result::Result<(), XlsxError> {
    let overview = &report.overview;
    sheet.set_column_width(0, 34.0)?;
    sheet.set_column_width(1, 24.0)?;
    sheet.set_landscape();
    sheet.set_print_fit_to_pages(1, 1);
    sheet.write_string_with_format(0, 0, &labels.title, &formats.title)?;

    let period = format!("{} - {}", display_date(&request.from), display_date(&request.to));
    let generated = format!(
        "{} {}",
        display_date(&report.generated_at[..10]),
        &report.generated_at[11..]
    );
    sheet.write_string_with_format(2, 0, &labels.period, &formats.label)?;
    sheet.write_string(2, 1, period)?;
    sheet.write_string_with_format(3, 0, &labels.generated_at, &formats.label)?;
    sheet.write_string(3, 1, generated)?;

    let left = Format::new().set_align(FormatAlign::Left);
    sheet.write_string_with_format(5, 0, &labels.appointments, &formats.label)?;
    sheet.write_number_with_format(5, 1, overview.appointments as f64, &left)?;
    sheet.write_string_with_format(6, 0, &labels.completion_rate, &formats.label)?;
    match overview.completion_rate {
        Some(rate) => sheet.write_number_with_format(6, 1, rate, &formats.percent)?,
        None => sheet.write_string(6, 1, "-")?,
    };
    sheet.write_string_with_format(7, 0, &labels.completed_of_past, &formats.label)?;
    sheet.write_string(7, 1, format!("{} / {}", overview.completed, overview.past))?;
    sheet.write_string_with_format(8, 0, &labels.booked_hours, &formats.label)?;
    sheet.write_number_with_format(8, 1, hours(overview.booked_minutes), &formats.hours)?;
    sheet.write_string_with_format(9, 0, &labels.overdue_cars, &formats.label)?;
    sheet.write_number_with_format(9, 1, overview.overdue_cars as f64, &left)?;
    sheet.write_string_with_format(10, 0, &labels.messages_sent, &formats.label)?;
    sheet.write_number_with_format(10, 1, overview.messages_sent as f64, &left)?;

    if report.load.is_empty() {
        return Ok(());
    }

    let last_row = report.load.len() as u32;
    let series_range = |column: u16| (labels.sheet_load.as_str(), 1, column, last_row, column);

    let mut per_day = Chart::new(ChartType::Column);
    per_day
        .add_series()
        .set_categories(series_range(0))
        .set_values(series_range(LOAD_COLUMN_APPOINTMENTS))
        .set_name(labels.appointments.as_str())
        .set_format(ChartSolidFill::new().set_color(Color::RGB(CHART_BLUE)));
    per_day.title().set_name(&labels.appointments_per_day);
    per_day.legend().set_hidden();
    if report.load.iter().all(|day| day.appointments <= WHOLE_UNIT_AXIS_LIMIT) {
        per_day.y_axis().set_major_unit(1.0);
    }
    per_day.x_axis().set_num_format("dd.mm");
    per_day.x_axis().set_text_axis(true);
    sheet.insert_chart(1, 3, &per_day)?;

    let points: Vec<ChartPoint> = report
        .load
        .iter()
        .map(|day| {
            let color = if day.overbooked { CHART_RED } else { CHART_BLUE };
            ChartPoint::new().set_format(ChartSolidFill::new().set_color(Color::RGB(color)))
        })
        .collect();

    let mut booked = Chart::new(ChartType::Column);
    booked
        .add_series()
        .set_categories(series_range(0))
        .set_values(series_range(LOAD_COLUMN_BOOKED))
        .set_name(labels.booked_hours.as_str())
        .set_format(ChartSolidFill::new().set_color(Color::RGB(CHART_BLUE)))
        .set_points(&points);
    booked.title().set_name(&labels.booked_per_day);
    booked.x_axis().set_num_format("dd.mm");
    booked.x_axis().set_text_axis(true);

    let mut capacity = Chart::new(ChartType::Line);
    capacity
        .add_series()
        .set_categories(series_range(0))
        .set_values(series_range(LOAD_COLUMN_CAPACITY))
        .set_name(labels.working_hours.as_str())
        // Separate marks, because a joined line would plunge on days off.
        .set_format(ChartLine::new().set_hidden(true))
        .set_marker(
            ChartMarker::new()
                .set_type(ChartMarkerType::LongDash)
                .set_size(CAPACITY_MARKER_SIZE)
                .set_format(ChartSolidFill::new().set_color(Color::RGB(CAPACITY_GREY))),
        );
    booked.combine(&capacity);
    sheet.insert_chart(17, 3, &booked)?;
    Ok(())
}

pub fn workbook_bytes(
    report: &Report,
    request: &ReportRequest,
    labels: &ExportLabels,
) -> std::result::Result<Vec<u8>, XlsxError> {
    let formats = Formats::new();
    let mut workbook = Workbook::new();

    let overview = workbook.add_worksheet().set_name(&labels.sheet_overview)?;
    write_overview(overview, report, request, labels, &formats)?;
    let schedule = workbook.add_worksheet().set_name(&labels.sheet_schedule)?;
    write_schedule(schedule, report, labels, &formats)?;
    let load = workbook.add_worksheet().set_name(&labels.sheet_load)?;
    write_load(load, report, labels, &formats)?;
    let due = workbook.add_worksheet().set_name(&labels.sheet_due)?;
    write_due(due, report, labels, &formats)?;

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

    fn request(from: &str, to: &str) -> ReportRequest {
        ReportRequest {
            from: from.into(),
            to: to.into(),
            working_days: vec![0, 1, 2, 3, 4],
            start_hour: 8,
            end_hour: 10,
        }
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

    fn book(conn: &Connection, client: i64, car: i64, time: &str, minutes: i64, done: bool) {
        conn.execute(
            "INSERT INTO appointments (ClientID, CarID, TimeDate, Duration, IsDone)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![client, car, time, minutes, done],
        )
        .unwrap();
    }

    fn date_offset(conn: &Connection, offset: &str) -> String {
        conn.query_row("SELECT date('now', 'localtime', ?1)", [offset], |row| row.get(0)).unwrap()
    }

    fn time_offset(conn: &Connection, offset: &str) -> String {
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M', 'now', 'localtime', ?1)", [offset], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn plates(report: &Report) -> Vec<(&str, &str)> {
        report.due.iter().map(|car| (car.state.as_str(), car.plate.as_str())).collect()
    }

    fn wide_request(conn: &Connection) -> ReportRequest {
        request(&date_offset(conn, "-10 days"), &date_offset(conn, "+10 days"))
    }

    #[test]
    fn completion_rate_ignores_appointments_not_yet_due() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", Some("2100-01-01"), 12);
        let client = add_client(&conn, "0722000000", Some(car));
        book(&conn, client, car, &time_offset(&conn, "-3 days"), 30, true);
        book(&conn, client, car, &time_offset(&conn, "-2 days"), 30, false);
        book(&conn, client, car, &time_offset(&conn, "+2 days"), 30, false);

        let report = build(&conn, &wide_request(&conn)).unwrap();

        assert_eq!(report.overview.appointments, 3);
        assert_eq!((report.overview.completed, report.overview.past), (1, 2));
        assert_eq!(report.overview.completion_rate, Some(0.5));
    }

    #[test]
    fn completion_rate_is_absent_when_nothing_has_passed() {
        let conn = test_connection();
        let report = build(&conn, &wide_request(&conn)).unwrap();
        assert_eq!(report.overview.completion_rate, None);
    }

    #[test]
    fn due_list_orders_states_and_skips_booked_and_valid_cars() {
        let conn = test_connection();
        let today = date_offset(&conn, "+0 days");
        let months_ago = |months: i64, days: &str| -> String {
            conn.query_row(
                "SELECT date(?1, ?2, ?3)",
                params![today, format!("-{months} months"), days],
                |row| row.get(0),
            )
            .unwrap()
        };

        add_car(&conn, "B4UNK", None, 12);
        add_car(&conn, "B3SOON", Some(&months_ago(12, "+10 days")), 12);
        add_car(&conn, "B2OVER", Some(&months_ago(12, "-10 days")), 12);
        add_car(&conn, "B5OK", Some(&months_ago(12, "+200 days")), 12);
        let booked = add_car(&conn, "B6BOOK", Some(&months_ago(12, "-10 days")), 12);
        let client = add_client(&conn, "0722000000", Some(booked));
        book(&conn, client, booked, &time_offset(&conn, "+1 days"), 30, false);

        let report = build(&conn, &wide_request(&conn)).unwrap();

        assert_eq!(
            plates(&report),
            [("overdue", "B2OVER"), ("soon", "B3SOON"), ("unknown", "B4UNK")]
        );
        assert_eq!(report.overview.overdue_cars, 1);
    }

    #[test]
    fn a_missed_appointment_does_not_hide_a_car_from_the_due_list() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None, 12);
        let client = add_client(&conn, "0722000000", Some(car));
        book(&conn, client, car, &time_offset(&conn, "-1 days"), 30, false);

        let report = build(&conn, &wide_request(&conn)).unwrap();

        assert_eq!(plates(&report), [("unknown", "B1AAA")]);
    }

    #[test]
    fn a_car_with_several_clients_is_one_row() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None, 12);
        add_client(&conn, "0733000000", Some(car));
        add_client(&conn, "0722000000", Some(car));

        let report = build(&conn, &wide_request(&conn)).unwrap();

        assert_eq!(report.due.len(), 1);
        assert_eq!(report.due[0].phones, "0722000000, 0733000000");
    }

    #[test]
    fn load_flags_days_above_working_hours_and_keeps_booked_days_off() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None, 12);
        let client = add_client(&conn, "0722000000", Some(car));
        // Monday 14 January 2030: 150 minutes against 120 available.
        book(&conn, client, car, "2030-01-14T08:00", 90, false);
        book(&conn, client, car, "2030-01-14T09:00", 60, false);
        // Tuesday exactly fills the day, which is not over.
        book(&conn, client, car, "2030-01-15T08:00", 120, false);
        // Sunday has no working hours.
        book(&conn, client, car, "2030-01-20T08:00", 30, false);

        let report = build(&conn, &request("2030-01-14", "2030-01-20")).unwrap();

        let days: Vec<(&str, i64, i64, bool)> = report
            .load
            .iter()
            .map(|d| (d.date.as_str(), d.booked_minutes, d.capacity_minutes, d.overbooked))
            .collect();
        assert_eq!(
            days,
            [
                ("2030-01-14", 150, 120, true),
                ("2030-01-15", 120, 120, false),
                ("2030-01-16", 0, 120, false),
                ("2030-01-17", 0, 120, false),
                ("2030-01-18", 0, 120, false),
                ("2030-01-20", 30, 0, true),
            ]
        );
        assert_eq!(report.load[0].weekday, 0);
        assert_eq!(report.load[5].weekday, 6);
    }

    #[test]
    fn schedule_includes_both_end_days_in_time_order() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", None, 12);
        let client = add_client(&conn, "0722000000", Some(car));
        for time in ["2030-01-16T23:30", "2030-01-14T09:00", "2030-01-14T08:00", "2030-01-17T00:00"] {
            book(&conn, client, car, time, 30, false);
        }

        let report = build(&conn, &request("2030-01-14", "2030-01-16")).unwrap();

        let found: Vec<(&str, &str)> =
            report.schedule.iter().map(|row| (row.date.as_str(), row.time.as_str())).collect();
        assert_eq!(found, [("2030-01-14", "08:00"), ("2030-01-14", "09:00"), ("2030-01-16", "23:30")]);
        assert_eq!(report.schedule[0].phone, "0722000000");
    }

    #[test]
    fn messages_sent_counts_only_sent_ones_in_the_period() {
        let conn = test_connection();
        let client = add_client(&conn, "0722000000", None);
        for (at, status) in [
            ("2030-01-13T23:59:59", "sent"),
            ("2030-01-14T00:00:00", "sent"),
            ("2030-01-16T23:59:59", "sent"),
            ("2030-01-15T10:00:00", "failed"),
            ("2030-01-17T00:00:00", "sent"),
        ] {
            conn.execute(
                "INSERT INTO messages (ClientID, Type, Text, SentAt, Status)
                 VALUES (?1, 'christmas', 'x', ?2, ?3)",
                params![client, at, status],
            )
            .unwrap();
        }

        let report = build(&conn, &request("2030-01-14", "2030-01-16")).unwrap();

        assert_eq!(report.overview.messages_sent, 2);
    }

    #[test]
    fn rejects_bad_ranges() {
        let conn = test_connection();
        let invalid = AppError::code("invalid_date");
        assert_eq!(build(&conn, &request("2030-02-30", "2030-03-01")).err(), Some(invalid));
        assert_eq!(
            build(&conn, &request("2030-02-02", "2030-02-01")).err(),
            Some(AppError::code("invalid_date"))
        );
        assert_eq!(
            build(&conn, &request("2030-01-01", "2031-01-02")).err(),
            Some(AppError::code("report_range_too_long"))
        );
        assert!(build(&conn, &request("2030-01-01", "2031-01-01")).is_ok());
    }

    fn labels() -> ExportLabels {
        let text = |_: &str| "x".to_string();
        ExportLabels {
            sheet_overview: "Overview".into(),
            sheet_schedule: "Schedule".into(),
            sheet_load: "Load".into(),
            sheet_due: "Due".into(),
            title: text("title"),
            period: text("period"),
            generated_at: text("generated"),
            appointments: text("appointments"),
            completed_of_past: text("completed"),
            completion_rate: text("rate"),
            overdue_cars: text("overdue"),
            messages_sent: text("messages"),
            booked_hours: text("hours"),
            appointments_per_day: text("chart"),
            booked_per_day: text("chart"),
            date: text("date"),
            weekday: text("weekday"),
            time: text("time"),
            duration_minutes: text("duration"),
            plate: text("plate"),
            manufacturer: text("manufacturer"),
            model: text("model"),
            phone: text("phone"),
            done: text("done"),
            yes: text("yes"),
            no: text("no"),
            working_hours: text("working"),
            load_percent: text("load"),
            status: text("status"),
            overbooked: text("over"),
            within_capacity: text("ok"),
            state_label: DueStateLabels {
                overdue: text("overdue"),
                soon: text("soon"),
                unknown: text("unknown"),
            },
            last_revision: text("last"),
            next_revision: text("next"),
            phones: text("phones"),
            weekdays: vec![text("weekday"); 7],
        }
    }

    #[test]
    fn workbook_is_written_with_and_without_data() {
        let conn = test_connection();
        let empty_range = request("2030-01-19", "2030-01-20");
        let empty = build(&conn, &empty_range).unwrap();
        assert!(workbook_bytes(&empty, &empty_range, &labels()).unwrap().starts_with(b"PK"));

        let car = add_car(&conn, "B1AAA", Some("2020-01-15"), 12);
        let client = add_client(&conn, "0722000000", Some(car));
        book(&conn, client, car, "2030-01-14T08:00", 30, false);
        let range = request("2030-01-14", "2030-01-20");
        let report = build(&conn, &range).unwrap();
        assert!(workbook_bytes(&report, &range, &labels()).unwrap().starts_with(b"PK"));
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
