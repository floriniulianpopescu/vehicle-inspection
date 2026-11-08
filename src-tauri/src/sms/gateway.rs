//! The Android phone running SMS Gate in local-server mode.

use std::time::Duration;

use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use serde_json::json;

use crate::data::AppError;

const DEFAULT_PORT: u16 = 8080;
const CONNECT_LIMIT: Duration = Duration::from_secs(5);
const REQUEST_LIMIT: Duration = Duration::from_secs(15);
const POLL_EVERY: Duration = Duration::from_secs(2);
const POLL_ATTEMPTS: u32 = 10;
/// Current versions use the first path, and the local-server guide documents the second.
const MESSAGE_PATHS: [&str; 2] = ["/messages", "/message"];

/// Whether the phone reported that this message left it.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Sent,
    Failed,
}

pub struct Gateway {
    http: Client,
    base: String,
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct MessageState {
    id: String,
    state: String,
}

/// "192.168.1.50" becomes "http://192.168.1.50:8080".
pub fn normalize_address(address: &str) -> Result<String, AppError> {
    let invalid = || AppError::code("sms_invalid_address");
    let trimmed = address.trim().trim_end_matches('/');
    let with_scheme =
        if trimmed.contains("://") { trimmed.to_string() } else { format!("http://{trimmed}") };
    let url = url::Url::parse(&with_scheme).map_err(|_| invalid())?;
    if url.scheme() != "http" || url.path() != "/" {
        return Err(invalid());
    }
    let host = url.host_str().ok_or_else(invalid)?;
    Ok(format!("http://{host}:{}", url.port().unwrap_or(DEFAULT_PORT)))
}

/// SMS Gate requires international format. Numbers are stored in national form.
pub fn international(phone: &str) -> Option<String> {
    if phone.starts_with('+') {
        Some(phone.to_string())
    } else {
        phone.strip_prefix('0').map(|rest| format!("+40{rest}"))
    }
}

fn unreachable(error: reqwest::Error) -> AppError {
    eprintln!("sms gateway unreachable: {error}");
    AppError::code("sms_gateway_unreachable")
}

fn outcome_of(state: &str) -> Option<Outcome> {
    match state {
        "Sent" | "Delivered" => Some(Outcome::Sent),
        "Failed" | "Cancelled" => Some(Outcome::Failed),
        _ => None,
    }
}

impl Gateway {
    pub fn new(address: &str, username: String, password: String) -> Result<Self, AppError> {
        let http = Client::builder()
            .connect_timeout(CONNECT_LIMIT)
            .timeout(REQUEST_LIMIT)
            .no_proxy()
            .build()
            .map_err(|e| AppError::from_message(e.to_string()))?;
        Ok(Self { http, base: normalize_address(address)?, username, password })
    }

    async fn get(&self, path: &str) -> Result<Response, AppError> {
        self.http
            .get(format!("{}{path}", self.base))
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(unreachable)
    }

    /// Any answer but "wrong credentials" means the phone is there and accepts them.
    pub async fn check(&self) -> Result<(), AppError> {
        let response = self.get("/messages/connection-check").await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(AppError::code("sms_gateway_auth"));
        }
        Ok(())
    }

    /// An error means the phone can't take messages at all, so a batch should stop.
    pub async fn send(&self, phone: &str, text: &str) -> Result<Outcome, AppError> {
        let Some(number) = international(phone) else {
            return Ok(Outcome::Failed);
        };
        let body = json!({ "textMessage": { "text": text }, "phoneNumbers": [number] });

        for path in MESSAGE_PATHS {
            let response = self
                .http
                .post(format!("{}{path}", self.base))
                .basic_auth(&self.username, Some(&self.password))
                .json(&body)
                .send()
                .await
                .map_err(unreachable)?;
            match response.status() {
                StatusCode::NOT_FOUND => continue,
                StatusCode::UNAUTHORIZED => return Err(AppError::code("sms_gateway_auth")),
                StatusCode::SERVICE_UNAVAILABLE => return Err(AppError::code("sms_gateway_busy")),
                status if !status.is_success() => {
                    eprintln!("sms gateway rejected a message: {status}");
                    return Ok(Outcome::Failed);
                }
                _ => {}
            }
            let accepted: MessageState = response.json().await.map_err(unreachable)?;
            if let Some(outcome) = outcome_of(&accepted.state) {
                return Ok(outcome);
            }
            return self.wait_for_result(path, &accepted.id).await;
        }
        Err(AppError::code("sms_gateway_unreachable"))
    }

    /// Unconfirmed counts as failed, so staff see it and can decide whether to resend.
    async fn wait_for_result(&self, path: &str, id: &str) -> Result<Outcome, AppError> {
        for _ in 0..POLL_ATTEMPTS {
            tokio::time::sleep(POLL_EVERY).await;
            let response = self.get(&format!("{path}/{id}")).await?;
            if !response.status().is_success() {
                continue;
            }
            let current: MessageState = response.json().await.map_err(unreachable)?;
            if let Some(outcome) = outcome_of(&current.state) {
                return Ok(outcome);
            }
        }
        Ok(Outcome::Failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_get_a_scheme_and_default_port() {
        assert_eq!(normalize_address("192.168.1.50").unwrap(), "http://192.168.1.50:8080");
        assert_eq!(normalize_address(" 192.168.1.50:9000/ ").unwrap(), "http://192.168.1.50:9000");
        assert_eq!(normalize_address("http://phone.local").unwrap(), "http://phone.local:8080");
    }

    #[test]
    fn bad_addresses_are_refused() {
        for address in ["", "ftp://1.2.3.4", "1.2.3.4/path", "https://1.2.3.4"] {
            assert_eq!(normalize_address(address), Err(AppError::code("sms_invalid_address")));
        }
    }

    #[test]
    fn numbers_become_international() {
        assert_eq!(international("0722111222").as_deref(), Some("+40722111222"));
        assert_eq!(international("+359888123456").as_deref(), Some("+359888123456"));
        assert_eq!(international("722111"), None);
    }

    #[test]
    fn only_final_states_end_the_wait() {
        assert_eq!(outcome_of("Delivered"), Some(Outcome::Sent));
        assert_eq!(outcome_of("Sent"), Some(Outcome::Sent));
        assert_eq!(outcome_of("Failed"), Some(Outcome::Failed));
        assert_eq!(outcome_of("Cancelled"), Some(Outcome::Failed));
        assert_eq!(outcome_of("Pending"), None);
        assert_eq!(outcome_of("Processed"), None);
    }
}
