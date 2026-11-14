//! Figures behind the Dashboard page: a few headline numbers and one series per chart.
//!
//! Charts choose from a fixed list of measures; every query is written here, so nothing the
//! page sends ever becomes SQL.

use std::collections::HashMap;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::data::{self, AppError};

type Result<T> = std::result::Result<T, AppError>;

/// Ranked lists show this many categories; the rest are added up as "other".
const TOP_CATEGORIES: usize = 12;
/// The key of the folded remainder.
const OTHER: &str = "__other";
/// Daily points over a longer period would be unreadable.
const MAX_DAYS_BY_DAY: i64 = 400;

/// Scopes every chart and number on the page.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    from: String,
    to: String,
    /// Inspection frequency in months; every car when empty.
    #[serde(default)]
    frequency: Option<i64>,
    /// Exact manufacturer, case ignored; every car when empty.
    #[serde(default)]
    manufacturer: Option<String>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    InspectionsOverTime,
    InspectionsByManufacturer,
    InspectionsByFrequency,
    InspectionsByWeekday,
    CarsByState,
    CarsByManufacturer,
    CarsByModel,
    CarsByFrequency,
    ExpiringOverTime,
    MessagesOverTime,
    MessagesByKind,
    MessagesByStatus,
    ClientsByVisits,
    NewVsReturning,
    NewVsReturningOverTime,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Grouping {
    Auto,
    Day,
    Week,
    Month,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    /// A date bucket ("2026-11", "2026-11-09") or a category; labels are made by the page.
    key: String,
    value: i64,
    /// For split measures, the value of each part, in the order of `Series::parts`.
    #[serde(skip_serializing_if = "Option::is_none")]
    parts: Option<Vec<i64>>,
}

impl Point {
    fn new(key: String, value: i64) -> Self {
        Self { key, value, parts: None }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    points: Vec<Point>,
    /// For measures over time, the grouping actually used.
    grouping: Option<Grouping>,
    /// For split measures, the names of the parts each point is divided into.
    parts: Option<Vec<&'static str>>,
}

impl Serialize for Grouping {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(match self {
            Grouping::Auto => "auto",
            Grouping::Day => "day",
            Grouping::Week => "week",
            Grouping::Month => "month",
        })
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    cars: i64,
    inspections: i64,
    expired: i64,
    messages_sent: i64,
}

/// Every query starts with this, so the four filters are always bound in the same places.
const FILTERS_CTE: &str = "WITH f(from_day, to_day, frequency, maker) AS (SELECT ?1, ?2, ?3, ?4)";

/// Cars `c` matching the frequency and manufacturer filters; needs `f` in scope.
const CAR_MATCHES: &str = "(f.frequency IS NULL OR c.RevisionFrequency = f.frequency)
     AND (f.maker IS NULL OR c.Manufacturer = f.maker COLLATE NOCASE)";

/// Messages `m` matching the car filters. Greetings belong to no car, so they only count
/// while no car filter is set.
const MESSAGE_MATCHES: &str = "((f.frequency IS NULL AND f.maker IS NULL)
     OR m.CarID IN (SELECT c.CarID FROM cars c WHERE (f.frequency IS NULL OR c.RevisionFrequency = f.frequency)
                    AND (f.maker IS NULL OR c.Manufacturer = f.maker COLLATE NOCASE)))";

fn validate(conn: &Connection, filters: &Filters) -> Result<i64> {
    let valid = data::has_format(conn, "%Y-%m-%d", &filters.from)?
        && data::has_format(conn, "%Y-%m-%d", &filters.to)?
        && filters.from <= filters.to;
    if !valid {
        return Err(AppError::code("invalid_date"));
    }
    Ok(conn.query_row(
        "SELECT CAST(julianday(?2) - julianday(?1) AS INTEGER) + 1",
        params![filters.from, filters.to],
        |row| row.get(0),
    )?)
}

fn bound(filters: &Filters) -> [&dyn rusqlite::ToSql; 4] {
    [&filters.from, &filters.to, &filters.frequency, &filters.manufacturer]
}

fn manufacturer_filter(filters: &Filters) -> Filters {
    let manufacturer = filters
        .manufacturer
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    Filters { manufacturer, ..filters.clone() }
}

/// Keys and counts from `sql`, which selects (key, count).
fn counts(conn: &Connection, sql: &str, filters: &Filters) -> Result<Vec<Point>> {
    let mut statement = conn.prepare(&format!("{FILTERS_CTE} {sql}"))?;
    let rows = statement.query_map(bound(filters), |row| {
        Ok(Point::new(row.get::<_, Option<String>>(0)?.unwrap_or_default(), row.get(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Largest first, with everything past the top categories added up as "other".
fn ranked(mut points: Vec<Point>) -> Vec<Point> {
    points.sort_by(|a, b| b.value.cmp(&a.value).then_with(|| a.key.cmp(&b.key)));
    if points.len() > TOP_CATEGORIES {
        let rest: i64 = points.drain(TOP_CATEGORIES..).map(|point| point.value).sum();
        points.push(Point::new(OTHER.to_string(), rest));
    }
    points
}

/// The given keys in this order, each with its count or zero.
fn ordered(points: Vec<Point>, keys: &[&str]) -> Vec<Point> {
    let found: HashMap<String, i64> = points.into_iter().map(|point| (point.key, point.value)).collect();
    keys.iter()
        .map(|key| Point::new(key.to_string(), found.get(*key).copied().unwrap_or(0)))
        .collect()
}

fn resolve(grouping: Grouping, days: i64) -> Result<Grouping> {
    Ok(match grouping {
        Grouping::Auto if days <= 62 => Grouping::Day,
        Grouping::Auto if days <= 366 => Grouping::Week,
        Grouping::Auto => Grouping::Month,
        Grouping::Day if days > MAX_DAYS_BY_DAY => return Err(AppError::code("dashboard_too_many_days")),
        other => other,
    })
}

/// The bucket a date column falls into: the day, the Monday of its week, or "YYYY-MM".
fn bucket(grouping: Grouping, column: &str) -> String {
    match grouping {
        Grouping::Week => format!(
            "date({column}, '-' || ((CAST(strftime('%w', {column}) AS INTEGER) + 6) % 7) || ' days')"
        ),
        Grouping::Month => format!("substr({column}, 1, 7)"),
        _ => format!("substr({column}, 1, 10)"),
    }
}

/// Counts per date bucket across the whole period, empty buckets included. `source` selects
/// one row per counted item with its date as `day`, already limited to the period.
fn over_time(conn: &Connection, filters: &Filters, grouping: Grouping, source: &str) -> Result<Vec<Point>> {
    let all = format!(
        "SELECT DISTINCT {bucket}, 0 FROM (
             WITH RECURSIVE days(d) AS (
                 SELECT from_day FROM f UNION ALL SELECT date(d, '+1 day') FROM days, f WHERE d < f.to_day
             ) SELECT d FROM days
         ) ORDER BY 1",
        bucket = bucket(grouping, "d"),
    );
    let keys = counts(conn, &all, filters)?;
    let found = counts(
        conn,
        &format!("SELECT {bucket}, COUNT(*) FROM ({source}) GROUP BY 1", bucket = bucket(grouping, "day")),
        filters,
    )?;
    let found: HashMap<String, i64> = found.into_iter().map(|point| (point.key, point.value)).collect();
    Ok(keys
        .into_iter()
        .map(|point| Point::new(point.key.clone(), found.get(&point.key).copied().unwrap_or(0)))
        .collect())
}

const INSPECTIONS_IN_PERIOD: &str = "FROM inspections i JOIN cars c ON c.CarID = i.CarID, f
     WHERE i.Date BETWEEN f.from_day AND f.to_day";

/// The two parts of the new vs returning measures.
const NEW_RETURNING: [&str; 2] = ["new", "returning"];

/// Every car inspected in the period, once, on its first visit there (`day`), marked
/// "returning" when that car was inspected here before or whoever brought it had come before
/// with any car, and "new" otherwise. Counting cars keeps a car with several phone numbers,
/// or a client with several cars, from being counted more than once.
fn first_visits() -> String {
    format!(
        "SELECT v.day AS day,
                CASE WHEN EXISTS (SELECT 1 FROM inspections p WHERE p.CarID = v.CarID AND p.Date < v.day)
                       OR (v.ClientID IS NOT NULL
                           AND EXISTS (SELECT 1 FROM inspections p WHERE p.ClientID = v.ClientID AND p.Date < v.day))
                     THEN 'returning' ELSE 'new' END AS kind
         FROM (SELECT i.CarID, i.ClientID, i.Date AS day,
                      ROW_NUMBER() OVER (PARTITION BY i.CarID ORDER BY i.Date, i.InspectionID) AS n
               {INSPECTIONS_IN_PERIOD} AND {CAR_MATCHES}) v
         WHERE v.n = 1"
    )
}

/// New and returning cars per date bucket, empty buckets included.
fn new_vs_returning_over_time(conn: &Connection, filters: &Filters, grouping: Grouping) -> Result<Vec<Point>> {
    let buckets = over_time(conn, filters, grouping, "SELECT NULL AS day WHERE 0")?;
    let found = counts(
        conn,
        &format!(
            "SELECT {bucket} || '|' || kind, COUNT(*) FROM ({visits}) GROUP BY 1",
            bucket = bucket(grouping, "day"),
            visits = first_visits(),
        ),
        filters,
    )?;
    let found: HashMap<String, i64> = found.into_iter().map(|point| (point.key, point.value)).collect();
    Ok(buckets
        .into_iter()
        .map(|point| {
            let parts: Vec<i64> = NEW_RETURNING
                .iter()
                .map(|kind| found.get(&format!("{}|{kind}", point.key)).copied().unwrap_or(0))
                .collect();
            Point { value: parts.iter().sum(), key: point.key, parts: Some(parts) }
        })
        .collect())
}

pub fn series(conn: &Connection, filters: &Filters, metric: Metric, grouping: Grouping) -> Result<Series> {
    let days = validate(conn, filters)?;
    let filters = &manufacturer_filter(filters);
    let state = data::revision_state_sql();
    let next = data::NEXT_REVISION;
    let timed = |grouping| -> Result<Option<Grouping>> { resolve(grouping, days).map(Some) };

    let parts = (metric == Metric::NewVsReturningOverTime).then(|| NEW_RETURNING.to_vec());
    let (points, grouping) = match metric {
        Metric::InspectionsOverTime => {
            let grouping = timed(grouping)?;
            let source = format!("SELECT i.Date AS day {INSPECTIONS_IN_PERIOD} AND {CAR_MATCHES}");
            (over_time(conn, filters, grouping.unwrap_or(Grouping::Day), &source)?, grouping)
        }
        Metric::InspectionsByManufacturer => (
            ranked(counts(
                conn,
                &format!("SELECT c.Manufacturer, COUNT(*) {INSPECTIONS_IN_PERIOD} AND {CAR_MATCHES} GROUP BY 1"),
                filters,
            )?),
            None,
        ),
        Metric::InspectionsByFrequency => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT CAST(c.RevisionFrequency AS TEXT), COUNT(*) {INSPECTIONS_IN_PERIOD}
                         AND {CAR_MATCHES} GROUP BY 1"
                    ),
                    filters,
                )?,
                &["6", "12", "24", "36"],
            ),
            None,
        ),
        Metric::InspectionsByWeekday => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT CAST((CAST(strftime('%w', i.Date) AS INTEGER) + 6) % 7 AS TEXT), COUNT(*)
                         {INSPECTIONS_IN_PERIOD} AND {CAR_MATCHES} GROUP BY 1"
                    ),
                    filters,
                )?,
                &["0", "1", "2", "3", "4", "5", "6"],
            ),
            None,
        ),
        Metric::CarsByState => (
            ordered(
                counts(conn, &format!("SELECT {state}, COUNT(*) FROM cars c, f WHERE {CAR_MATCHES} GROUP BY 1"), filters)?,
                &["ok", "soon", "overdue", "unknown"],
            ),
            None,
        ),
        Metric::CarsByManufacturer => (
            ranked(counts(
                conn,
                &format!("SELECT c.Manufacturer, COUNT(*) FROM cars c, f WHERE {CAR_MATCHES} GROUP BY 1"),
                filters,
            )?),
            None,
        ),
        Metric::CarsByModel => (
            ranked(counts(
                conn,
                &format!(
                    "SELECT c.Manufacturer || ' ' || c.Model, COUNT(*) FROM cars c, f WHERE {CAR_MATCHES} GROUP BY 1"
                ),
                filters,
            )?),
            None,
        ),
        Metric::CarsByFrequency => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT CAST(c.RevisionFrequency AS TEXT), COUNT(*) FROM cars c, f WHERE {CAR_MATCHES} GROUP BY 1"
                    ),
                    filters,
                )?,
                &["6", "12", "24", "36"],
            ),
            None,
        ),
        Metric::ExpiringOverTime => {
            let grouping = timed(grouping)?;
            let source = format!(
                "SELECT {next} AS day FROM cars c, f
                 WHERE c.LastRevision IS NOT NULL AND {CAR_MATCHES} AND {next} BETWEEN f.from_day AND f.to_day"
            );
            (over_time(conn, filters, grouping.unwrap_or(Grouping::Day), &source)?, grouping)
        }
        Metric::MessagesOverTime => {
            let grouping = timed(grouping)?;
            let source = format!(
                "SELECT substr(m.SentAt, 1, 10) AS day FROM messages m, f
                 WHERE m.Status = 'sent' AND substr(m.SentAt, 1, 10) BETWEEN f.from_day AND f.to_day
                   AND {MESSAGE_MATCHES}"
            );
            (over_time(conn, filters, grouping.unwrap_or(Grouping::Day), &source)?, grouping)
        }
        Metric::MessagesByKind => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT m.Type, COUNT(*) FROM messages m, f
                         WHERE m.Status = 'sent' AND substr(m.SentAt, 1, 10) BETWEEN f.from_day AND f.to_day
                           AND {MESSAGE_MATCHES} GROUP BY 1"
                    ),
                    filters,
                )?,
                &["inspection", "christmas", "new_year", "easter", "feedback"],
            ),
            None,
        ),
        Metric::MessagesByStatus => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT m.Status, COUNT(*) FROM messages m, f
                         WHERE substr(m.SentAt, 1, 10) BETWEEN f.from_day AND f.to_day AND {MESSAGE_MATCHES}
                         GROUP BY 1"
                    ),
                    filters,
                )?,
                &["sent", "failed"],
            ),
            None,
        ),
        Metric::NewVsReturning => (
            ordered(
                counts(conn, &format!("SELECT kind, COUNT(*) FROM ({}) GROUP BY 1", first_visits()), filters)?,
                &NEW_RETURNING,
            ),
            None,
        ),
        Metric::NewVsReturningOverTime => {
            let grouping = timed(grouping)?;
            (new_vs_returning_over_time(conn, filters, grouping.unwrap_or(Grouping::Day))?, grouping)
        }
        Metric::ClientsByVisits => (
            ordered(
                counts(
                    conn,
                    &format!(
                        "SELECT CASE WHEN visits >= 4 THEN '4+' ELSE CAST(visits AS TEXT) END, COUNT(*) FROM (
                             SELECT cl.ClientID, (SELECT COUNT(*) FROM inspections i JOIN cars c ON c.CarID = i.CarID
                                                  WHERE i.ClientID = cl.ClientID AND {CAR_MATCHES}) AS visits
                             FROM clients cl, f
                         ) GROUP BY 1"
                    ),
                    filters,
                )?,
                &["0", "1", "2", "3", "4+"],
            ),
            None,
        ),
    };
    Ok(Series { points, grouping, parts })
}

pub fn summary(conn: &Connection, filters: &Filters) -> Result<Summary> {
    validate(conn, filters)?;
    let filters = &manufacturer_filter(filters);
    let state = data::revision_state_sql();
    let sql = format!(
        "{FILTERS_CTE} SELECT
             (SELECT COUNT(*) FROM cars c, f WHERE {CAR_MATCHES}),
             (SELECT COUNT(*) {INSPECTIONS_IN_PERIOD} AND {CAR_MATCHES}),
             (SELECT COUNT(*) FROM cars c, f WHERE {CAR_MATCHES} AND {state} = 'overdue'),
             (SELECT COUNT(*) FROM messages m, f
              WHERE m.Status = 'sent' AND substr(m.SentAt, 1, 10) BETWEEN f.from_day AND f.to_day
                AND {MESSAGE_MATCHES})"
    );
    Ok(conn.query_row(&sql, bound(filters), |row| {
        Ok(Summary { cars: row.get(0)?, inspections: row.get(1)?, expired: row.get(2)?, messages_sent: row.get(3)? })
    })?)
}

/// Every manufacturer in the database, for the filter.
pub fn manufacturers(conn: &Connection) -> Result<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT DISTINCT Manufacturer FROM cars ORDER BY Manufacturer COLLATE NOCASE")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_connection;

    fn filters(from: &str, to: &str) -> Filters {
        Filters { from: from.into(), to: to.into(), frequency: None, manufacturer: None }
    }

    fn add_car(conn: &Connection, plate: &str, maker: &str, last: Option<&str>, months: i64) -> i64 {
        conn.execute(
            "INSERT INTO cars (Plate, Manufacturer, Model, LastRevision, RevisionFrequency)
             VALUES (?1, ?2, 'X', ?3, ?4)",
            params![plate, maker, last, months],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn inspect(conn: &Connection, car: i64, date: &str) {
        conn.execute("INSERT INTO inspections (CarID, Date) VALUES (?1, ?2)", params![car, date]).unwrap();
    }

    fn values(series: &Series) -> Vec<(&str, i64)> {
        series.points.iter().map(|point| (point.key.as_str(), point.value)).collect()
    }

    #[test]
    fn inspections_over_time_include_empty_buckets() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", "Dacia", None, 12);
        inspect(&conn, car, "2030-01-02");
        inspect(&conn, car, "2030-03-15");

        let monthly =
            series(&conn, &filters("2030-01-01", "2030-03-31"), Metric::InspectionsOverTime, Grouping::Month).unwrap();
        assert_eq!(values(&monthly), [("2030-01", 1), ("2030-02", 0), ("2030-03", 1)]);

        // 2030-01-02 is a Wednesday; its week starts on Monday 2029-12-31.
        let weekly =
            series(&conn, &filters("2030-01-01", "2030-01-08"), Metric::InspectionsOverTime, Grouping::Week).unwrap();
        assert_eq!(values(&weekly), [("2029-12-31", 1), ("2030-01-07", 0)]);
    }

    #[test]
    fn automatic_grouping_follows_the_length_of_the_period() {
        let conn = test_connection();
        let pick = |from: &str, to: &str| {
            series(&conn, &filters(from, to), Metric::InspectionsOverTime, Grouping::Auto).unwrap().grouping
        };
        assert_eq!(pick("2030-01-01", "2030-01-31"), Some(Grouping::Day));
        assert_eq!(pick("2030-01-01", "2030-06-30"), Some(Grouping::Week));
        assert_eq!(pick("2030-01-01", "2031-12-31"), Some(Grouping::Month));
        assert_eq!(
            series(&conn, &filters("2030-01-01", "2031-12-31"), Metric::InspectionsOverTime, Grouping::Day).err(),
            Some(AppError::code("dashboard_too_many_days"))
        );
    }

    #[test]
    fn car_filters_narrow_every_measure() {
        let conn = test_connection();
        let dacia = add_car(&conn, "B1AAA", "Dacia", Some("2020-01-01"), 12);
        let ford = add_car(&conn, "B2AAA", "Ford", Some("2029-12-01"), 24);
        inspect(&conn, dacia, "2030-01-05");
        inspect(&conn, ford, "2030-01-06");
        let period = filters("2030-01-01", "2030-01-31");

        let all = series(&conn, &period, Metric::InspectionsByManufacturer, Grouping::Auto).unwrap();
        assert_eq!(values(&all), [("Dacia", 1), ("Ford", 1)]);

        let ford_only = Filters { manufacturer: Some(" ford ".into()), ..period.clone() };
        let narrowed = series(&conn, &ford_only, Metric::CarsByFrequency, Grouping::Auto).unwrap();
        assert_eq!(values(&narrowed), [("6", 0), ("12", 0), ("24", 1), ("36", 0)]);

        let yearly = Filters { frequency: Some(12), ..period.clone() };
        assert_eq!(summary(&conn, &yearly).unwrap(), Summary { cars: 1, inspections: 1, expired: 1, messages_sent: 0 });
    }

    #[test]
    fn long_category_lists_fold_into_other() {
        let conn = test_connection();
        for index in 0..15 {
            add_car(&conn, &format!("B{index}AAA"), &format!("Maker{index:02}"), None, 12);
        }
        add_car(&conn, "B99AAA", "Maker00", None, 12);

        let found = series(&conn, &filters("2030-01-01", "2030-01-31"), Metric::CarsByManufacturer, Grouping::Auto)
            .unwrap();
        assert_eq!(found.points.len(), TOP_CATEGORIES + 1);
        assert_eq!(values(&found)[0], ("Maker00", 2));
        assert_eq!(found.points.last().unwrap().key, OTHER);
        assert_eq!(found.points.last().unwrap().value, 3);
    }

    #[test]
    fn greetings_count_only_without_car_filters() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", "Dacia", None, 12);
        conn.execute("INSERT INTO clients (Phone) VALUES ('0722000001')", []).unwrap();
        for (car_id, kind) in [(Some(car), "inspection"), (None, "christmas")] {
            conn.execute(
                "INSERT INTO messages (ClientID, CarID, Type, Text, SentAt, Status)
                 VALUES (1, ?1, ?2, 'x', '2030-01-05T10:00:00', 'sent')",
                params![car_id, kind],
            )
            .unwrap();
        }
        let period = filters("2030-01-01", "2030-01-31");
        let by_kind = |filters: &Filters| {
            series(&conn, filters, Metric::MessagesByKind, Grouping::Auto).unwrap().points[..2]
                .iter()
                .map(|point| point.value)
                .collect::<Vec<_>>()
        };
        assert_eq!(by_kind(&period), [1, 1]);
        assert_eq!(by_kind(&Filters { manufacturer: Some("Dacia".into()), ..period.clone() }), [1, 0]);
    }

    fn visit(conn: &Connection, car: i64, client: Option<i64>, date: &str) {
        conn.execute(
            "INSERT INTO inspections (CarID, ClientID, Date) VALUES (?1, ?2, ?3)",
            params![car, client, date],
        )
        .unwrap();
    }

    fn client(conn: &Connection, phone: &str) -> i64 {
        conn.execute("INSERT INTO clients (Phone) VALUES (?1)", [phone]).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn a_car_or_its_bringer_seen_before_makes_a_returning_client() {
        let conn = test_connection();
        let regular = client(&conn, "0722000001");
        let newcomer = client(&conn, "0722000002");
        let new_phone = client(&conn, "0722000003");

        // Same car came last year, now brought under a new phone number: returning.
        let old_car = add_car(&conn, "B1AAA", "Dacia", None, 12);
        visit(&conn, old_car, Some(regular), "2029-01-10");
        visit(&conn, old_car, Some(new_phone), "2030-01-10");
        // A known client brings a car never seen before: returning.
        let second_car = add_car(&conn, "B2AAA", "Ford", None, 12);
        visit(&conn, second_car, Some(regular), "2030-01-12");
        // Nobody and nothing seen before: new, and counted once despite two visits in the period.
        let fresh = add_car(&conn, "B3AAA", "Opel", None, 6);
        visit(&conn, fresh, Some(newcomer), "2030-01-05");
        visit(&conn, fresh, Some(newcomer), "2030-01-25");
        // Unknown bringer and an unseen car: new.
        let unknown = add_car(&conn, "B4AAA", "Opel", None, 12);
        visit(&conn, unknown, None, "2030-01-20");

        let period = filters("2030-01-01", "2030-01-31");
        let totals = series(&conn, &period, Metric::NewVsReturning, Grouping::Auto).unwrap();
        assert_eq!(values(&totals), [("new", 2), ("returning", 2)]);

        // Only Ford cars: the known client still counts as returning, by their earlier visit.
        let ford = Filters { manufacturer: Some("Ford".into()), ..period.clone() };
        let narrowed = series(&conn, &ford, Metric::NewVsReturning, Grouping::Auto).unwrap();
        assert_eq!(values(&narrowed), [("new", 0), ("returning", 1)]);
    }

    #[test]
    fn new_and_returning_are_split_per_bucket() {
        let conn = test_connection();
        let regular = client(&conn, "0722000001");
        let car = add_car(&conn, "B1AAA", "Dacia", None, 12);
        visit(&conn, car, Some(regular), "2029-12-01");
        visit(&conn, car, Some(regular), "2030-02-03");
        let other = add_car(&conn, "B2AAA", "Dacia", None, 12);
        visit(&conn, other, None, "2030-01-15");

        let found =
            series(&conn, &filters("2030-01-01", "2030-03-31"), Metric::NewVsReturningOverTime, Grouping::Month)
                .unwrap();
        assert_eq!(found.parts, Some(vec!["new", "returning"]));
        let split: Vec<(&str, Option<&Vec<i64>>)> =
            found.points.iter().map(|point| (point.key.as_str(), point.parts.as_ref())).collect();
        assert_eq!(
            split,
            [("2030-01", Some(&vec![1, 0])), ("2030-02", Some(&vec![0, 1])), ("2030-03", Some(&vec![0, 0]))]
        );
    }

    #[test]
    fn clients_are_grouped_by_their_number_of_visits() {
        let conn = test_connection();
        let car = add_car(&conn, "B1AAA", "Dacia", None, 12);
        conn.execute("INSERT INTO clients (Phone) VALUES ('0722000001'), ('0722000002')", []).unwrap();
        for date in ["2028-01-01", "2029-01-01"] {
            conn.execute("INSERT INTO inspections (CarID, ClientID, Date) VALUES (?1, 1, ?2)", params![car, date])
                .unwrap();
        }
        let found =
            series(&conn, &filters("2030-01-01", "2030-01-31"), Metric::ClientsByVisits, Grouping::Auto).unwrap();
        assert_eq!(values(&found), [("0", 1), ("1", 0), ("2", 1), ("3", 0), ("4+", 0)]);
    }
}
