//! Greetings sent through WhatsApp Web, in a separate window of the app.
//!
//! WhatsApp has no free official way to send messages, so this does what a person would do:
//! it opens WhatsApp Web's chat link with the text filled in, then presses Send. The station
//! scans the QR code once; the login is kept in this window's own browser profile.
//!
//! The window gets no access to the app's commands. A script injected into the page reports
//! back by setting the page title to a marker followed by JSON, which the app watches for.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;

use crate::data::AppError;

const LABEL: &str = "whatsapp";
const WHATSAPP_WEB: &str = "https://web.whatsapp.com";
const TITLE_MARKER: &str = "__VI__";
const INJECT: &str = include_str!("inject.js");
const STATUS_LIMIT: Duration = Duration::from_secs(4);
/// Restoring a saved login after the window opens can take a while.
const READY_LIMIT: Duration = Duration::from_secs(45);
/// Opening the chat, sending and waiting for WhatsApp to confirm.
const SEND_LIMIT: Duration = Duration::from_secs(120);
const RETRY_EVERY: Duration = Duration::from_secs(1);
/// WhatsApp Web refuses browsers it does not recognise; on Windows the engine is Edge already.
#[cfg(not(windows))]
const CHROME_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/// Debug builds can point at a stand-in page instead of the real WhatsApp Web.
#[cfg(debug_assertions)]
const FAKE_VAR: &str = "VEHICLE_INSPECTION_FAKE_WHATSAPP";

type Result<T> = std::result::Result<T, AppError>;

#[derive(Default)]
pub struct WhatsAppService {
    waiting: Mutex<HashMap<String, oneshot::Sender<Report>>>,
    next_token: AtomicU64,
}

#[derive(Deserialize, Debug)]
struct Report {
    token: String,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    result: Option<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Connection {
    /// The WhatsApp window is not open.
    Closed,
    Loading,
    /// Waiting for the QR code to be scanned.
    Qr,
    Ready,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Sent,
    NotOnWhatsApp,
    Failed,
}

fn base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(fake) = std::env::var(FAKE_VAR) {
        return fake.trim_end_matches('/').to_string();
    }
    WHATSAPP_WEB.to_string()
}

fn error(error: impl std::fmt::Display) -> AppError {
    AppError::from_message(error.to_string())
}

/// WhatsApp links use the international number without "+": "0722123456" becomes "40722123456".
pub fn link_phone(phone: &str) -> Option<String> {
    let digits = match phone.strip_prefix('+') {
        Some(rest) => rest.to_string(),
        None => format!("40{}", phone.strip_prefix('0')?),
    };
    digits.chars().all(|c| c.is_ascii_digit()).then_some(digits)
}

fn deliver(app: &AppHandle, title: &str) {
    let Some(json) = title.strip_prefix(TITLE_MARKER) else { return };
    let Ok(report) = serde_json::from_str::<Report>(json) else { return };
    let service = app.state::<WhatsAppService>();
    let sender = service.waiting.lock().ok().and_then(|mut waiting| waiting.remove(&report.token));
    if let Some(sender) = sender {
        let _ = sender.send(report);
    }
}

fn window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let url: Url = base_url().parse().map_err(error)?;
    let profile = app.path().app_data_dir().map_err(error)?.join("whatsapp-web");
    let handle = app.clone();
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("WhatsApp")
        .inner_size(1100.0, 800.0)
        .visible(false)
        // Its own browser profile, so logging out never touches the main window's settings.
        .data_directory(profile)
        .initialization_script(INJECT)
        .on_document_title_changed(move |_, title| deliver(&handle, &title));
    #[cfg(not(windows))]
    let builder = builder.user_agent(CHROME_USER_AGENT);
    builder.build().map_err(error)
}

/// Runs `call` in the page until it reports back with the same token, or the limit passes.
/// It is repeated because the page may still be loading when it is first run.
async fn ask(
    app: &AppHandle,
    window: &WebviewWindow,
    call: impl Fn(&str) -> String,
    limit: Duration,
) -> Option<Report> {
    let service = app.state::<WhatsAppService>();
    let token = format!("t{}", service.next_token.fetch_add(1, Ordering::SeqCst));
    let (sender, mut receiver) = oneshot::channel();
    service.waiting.lock().ok()?.insert(token.clone(), sender);

    let started = Instant::now();
    let script = call(&token);
    let report = loop {
        if window.eval(&script).is_err() {
            break None;
        }
        tokio::select! {
            report = &mut receiver => break report.ok(),
            _ = tokio::time::sleep(RETRY_EVERY) => {}
        }
        if started.elapsed() >= limit {
            break None;
        }
    };
    if let Ok(mut waiting) = service.waiting.lock() {
        waiting.remove(&token);
    }
    report
}

async fn probe(app: &AppHandle, window: &WebviewWindow) -> Connection {
    let report = ask(
        app,
        window,
        |token| format!("window.__vi && window.__vi.probe({})", json(token)),
        STATUS_LIMIT,
    )
    .await;
    match report.and_then(|report| report.state).as_deref() {
        Some("ready") => Connection::Ready,
        Some("qr") => Connection::Qr,
        _ => Connection::Loading,
    }
}

fn json(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

pub async fn status(app: &AppHandle) -> Result<Connection> {
    match app.get_webview_window(LABEL) {
        Some(window) => Ok(probe(app, &window).await),
        None => Ok(Connection::Closed),
    }
}

/// Shows the WhatsApp window, opening it if needed, for scanning the QR code.
pub fn open(app: &AppHandle) -> Result<()> {
    let window = window(app)?;
    window.show().map_err(error)?;
    window.unminimize().map_err(error)?;
    window.set_focus().map_err(error)
}

/// Logs WhatsApp Web out by clearing this window's browser profile.
pub fn log_out(app: &AppHandle) -> Result<()> {
    let window = window(app)?;
    window.clear_all_browsing_data().map_err(error)?;
    window.navigate(base_url().parse().map_err(error)?).map_err(error)
}

/// Opens the window if needed and waits until WhatsApp Web is logged in.
pub async fn ensure_ready(app: &AppHandle) -> Result<()> {
    let window = window(app)?;
    let started = Instant::now();
    loop {
        match probe(app, &window).await {
            Connection::Ready => return Ok(()),
            Connection::Qr => return Err(AppError::code("whatsapp_not_connected")),
            _ if started.elapsed() >= READY_LIMIT => {
                return Err(AppError::code("whatsapp_not_connected"));
            }
            _ => tokio::time::sleep(RETRY_EVERY).await,
        }
    }
}

pub async fn send(app: &AppHandle, phone: &str, text: &str) -> Result<Outcome> {
    let Some(link) = link_phone(phone) else { return Ok(Outcome::NotOnWhatsApp) };
    let window = window(app)?;
    // Hidden windows can be paused by the system, so it stays visible while sending.
    window.show().map_err(error)?;

    let mut url: Url = format!("{}/send", base_url()).parse().map_err(error)?;
    url.query_pairs_mut().append_pair("phone", &link).append_pair("text", text);
    window.navigate(url).map_err(error)?;

    let report = ask(
        app,
        &window,
        |token| {
            format!(
                "window.__vi && window.__vi.send({}, {}, {})",
                json(token),
                json(&link),
                json(text)
            )
        },
        SEND_LIMIT,
    )
    .await;
    match report.and_then(|report| report.result).as_deref() {
        // Queued means WhatsApp holds it and sends it as soon as it can, so it is not retried.
        Some("sent" | "queued") => Ok(Outcome::Sent),
        Some("invalid") => Ok(Outcome::NotOnWhatsApp),
        Some("not_ready") => Err(AppError::code("whatsapp_not_connected")),
        _ => Ok(Outcome::Failed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_become_whatsapp_link_form() {
        assert_eq!(link_phone("0722123456").as_deref(), Some("40722123456"));
        assert_eq!(link_phone("+393331234567").as_deref(), Some("393331234567"));
        assert_eq!(link_phone("722123456"), None);
    }
}
