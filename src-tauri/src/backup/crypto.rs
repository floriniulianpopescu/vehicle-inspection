//! Passphrase encryption for backup files.
//!
//! File layout: magic, salt, nonce, then the XChaCha20-Poly1305 ciphertext.
//! The magic also fixes the key-derivation settings, so changing them means a new magic.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};

use crate::data::AppError;

const MAGIC: &[u8; 4] = b"VIB1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = MAGIC.len() + SALT_LEN + NONCE_LEN;
const KEY_LEN: usize = 32;

const MEMORY_KIB: u32 = 64 * 1024;
const ITERATIONS: u32 = 3;
const PARALLELISM: u32 = 1;

fn cipher_for(passphrase: &str, salt: &[u8]) -> Result<XChaCha20Poly1305, AppError> {
    let params = Params::new(MEMORY_KIB, ITERATIONS, PARALLELISM, Some(KEY_LEN))
        .map_err(|e| AppError::from_message(e.to_string()))?;
    let mut key = [0u8; KEY_LEN];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::from_message(e.to_string()))?;
    XChaCha20Poly1305::new_from_slice(&key).map_err(|e| AppError::from_message(e.to_string()))
}

pub fn encrypt(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut header = [0u8; HEADER_LEN];
    header[..MAGIC.len()].copy_from_slice(MAGIC);
    getrandom::fill(&mut header[MAGIC.len()..]).map_err(|e| AppError::from_message(e.to_string()))?;

    let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce: [u8; NONCE_LEN] = header[MAGIC.len() + SALT_LEN..]
        .try_into()
        .map_err(|_| AppError::code("backup_invalid"))?;

    let ciphertext = cipher_for(passphrase, salt)?
        .encrypt(&XNonce::from(nonce), Payload { msg: plaintext, aad: &header })
        .map_err(|e| AppError::from_message(e.to_string()))?;

    let mut file = header.to_vec();
    file.extend_from_slice(&ciphertext);
    Ok(file)
}

pub fn decrypt(passphrase: &str, file: &[u8]) -> Result<Vec<u8>, AppError> {
    if file.len() < HEADER_LEN || !file.starts_with(MAGIC) {
        return Err(AppError::code("backup_invalid"));
    }
    let (header, ciphertext) = file.split_at(HEADER_LEN);
    let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce: [u8; NONCE_LEN] = header[MAGIC.len() + SALT_LEN..]
        .try_into()
        .map_err(|_| AppError::code("backup_invalid"))?;

    cipher_for(passphrase, salt)?
        .decrypt(&XNonce::from(nonce), Payload { msg: ciphertext, aad: header })
        .map_err(|_| AppError::code("wrong_passphrase"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let file = encrypt("correct horse", b"SQLite format 3").unwrap();
        assert_eq!(decrypt("correct horse", &file).unwrap(), b"SQLite format 3");
    }

    #[test]
    fn plaintext_does_not_appear_in_the_file() {
        let file = encrypt("correct horse", b"0722000000").unwrap();
        assert!(!file.windows(10).any(|window| window == b"0722000000"));
    }

    #[test]
    fn same_input_encrypts_differently() {
        assert_ne!(encrypt("a passphrase", b"x").unwrap(), encrypt("a passphrase", b"x").unwrap());
    }

    #[test]
    fn wrong_passphrase_is_reported() {
        let file = encrypt("correct horse", b"data").unwrap();
        assert_eq!(decrypt("wrong horse", &file), Err(AppError::code("wrong_passphrase")));
    }

    #[test]
    fn tampering_is_detected_in_body_and_header() {
        let file = encrypt("correct horse", b"data").unwrap();
        for position in [file.len() - 1, MAGIC.len()] {
            let mut changed = file.clone();
            changed[position] ^= 1;
            assert!(decrypt("correct horse", &changed).is_err());
        }
    }

    #[test]
    fn other_files_are_invalid() {
        assert_eq!(decrypt("x", b"short"), Err(AppError::code("backup_invalid")));
        assert_eq!(decrypt("x", &[0u8; 200]), Err(AppError::code("backup_invalid")));
    }
}
