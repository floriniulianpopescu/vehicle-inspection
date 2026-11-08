use std::path::Path;
use std::{env, fs};

/// Downloaded from Google Cloud (OAuth client, type "Desktop app"). Not committed.
const OAUTH_CLIENT_FILE: &str = "google-oauth-client.json";

fn embed_oauth_client() {
    println!("cargo:rerun-if-changed={OAUTH_CLIENT_FILE}");
    let out_dir = env::var("OUT_DIR").expect("cargo sets OUT_DIR");
    let contents = fs::read_to_string(OAUTH_CLIENT_FILE).unwrap_or_else(|_| "{}".to_string());
    fs::write(Path::new(&out_dir).join(OAUTH_CLIENT_FILE), contents)
        .expect("OUT_DIR is writable");
}

fn main() {
    embed_oauth_client();
    tauri_build::build()
}
