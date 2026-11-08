//! The Google token and backup passphrase, kept in the OS credential store.
//!
//! These calls block, so run them off the async runtime.

use keyring::{Entry, Error};

use crate::data::AppError;

const SERVICE: &str = "com.iulian.vehicle-inspection";

#[derive(Clone, Copy)]
pub enum Secret {
    RefreshToken,
    Passphrase,
    SmsGatewayPassword,
}

impl Secret {
    fn name(self) -> &'static str {
        match self {
            Secret::RefreshToken => "google-refresh-token",
            Secret::Passphrase => "backup-passphrase",
            Secret::SmsGatewayPassword => "sms-gateway-password",
        }
    }

    fn entry(self) -> Result<Entry, AppError> {
        Entry::new(SERVICE, self.name()).map_err(unavailable)
    }

    pub fn get(self) -> Result<Option<String>, AppError> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(unavailable(error)),
        }
    }

    pub fn set(self, value: &str) -> Result<(), AppError> {
        self.entry()?.set_password(value).map_err(unavailable)
    }

    pub fn delete(self) -> Result<(), AppError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(unavailable(error)),
        }
    }
}

fn unavailable(error: Error) -> AppError {
    eprintln!("credential store error: {error}");
    AppError::code("credentials_unavailable")
}
