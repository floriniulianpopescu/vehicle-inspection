use std::path::Path;
use std::{env, fs};

/// Downloaded from Google Cloud (OAuth client, type "Desktop app"). Not committed.
const OAUTH_CLIENT_FILE: &str = "google-oauth-client.json";

/// Copies the Google client file into the build, or an empty one when it is missing. Problems
/// are printed as build warnings, since the app can only say "not configured" afterwards.
fn embed_oauth_client() {
    println!("cargo:rerun-if-changed={OAUTH_CLIENT_FILE}");
    println!("cargo:rerun-if-changed=build.rs");
    let out_dir = env::var("OUT_DIR").expect("cargo sets OUT_DIR");
    let contents = match fs::read_to_string(OAUTH_CLIENT_FILE) {
        // Notepad can start a file with an invisible byte-order mark, which JSON does not allow.
        Ok(text) => text.trim_start_matches('\u{feff}').to_string(),
        Err(_) => {
            // Cargo only re-runs this script when a watched file is newer than the last run, and a
            // copied file keeps its old date. A path that never exists counts as always changed,
            // so this script runs on every build until the file is there, whatever its date.
            println!("cargo:rerun-if-changed={OAUTH_CLIENT_FILE}.not-there-yet");
            println!(
                "cargo:warning={OAUTH_CLIENT_FILE} was not found in src-tauri, so Google Drive \
                 backups will be off in this build. On Windows, check the name is not \
                 {OAUTH_CLIENT_FILE}.json (file extensions are hidden by default)."
            );
            "{}".to_string()
        }
    };
    let is_desktop_client = serde_json::from_str::<serde_json::Value>(&contents)
        .ok()
        .and_then(|json| json.get("installed")?.get("client_id")?.as_str().map(str::to_owned))
        .is_some();
    if contents != "{}" && !is_desktop_client {
        println!(
            "cargo:warning={OAUTH_CLIENT_FILE} is not a Google \"Desktop app\" client file (it \
             should start with {{\"installed\": ...). Google Drive backups will be off in this build."
        );
    }
    fs::write(Path::new(&out_dir).join(OAUTH_CLIENT_FILE), contents).expect("OUT_DIR is writable");
}

fn main() {
    embed_oauth_client();
    tauri_build::build()
}
