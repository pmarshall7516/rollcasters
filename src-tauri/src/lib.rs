use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;

const LOCAL_SETTINGS_FILE: &str = "settings.json";
static CREDENTIAL_STORE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn credential_service(app: &tauri::AppHandle) -> String {
    format!("{}.accounts.v1", app.config().identifier)
}

fn credential_entry(app: &tauri::AppHandle, user_id: &str) -> Result<keyring::Entry, String> {
    if user_id.is_empty() || user_id.chars().any(|character| character.is_control() || matches!(character, '/' | '\\')) {
        return Err("Invalid account identifier.".to_string());
    }
    keyring::Entry::new(&credential_service(app), user_id).map_err(|_| "Unable to access the secure credential store.".to_string())
}

#[tauri::command]
fn secure_credential_get(app: tauri::AppHandle, user_id: String) -> Result<Option<String>, String> {
    let _lock = CREDENTIAL_STORE_LOCK.lock().map_err(|_| "Secure credential store is unavailable.".to_string())?;
    let entry = credential_entry(&app, &user_id)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Unable to access the secure credential store.".to_string()),
    }
}

#[tauri::command]
fn secure_credential_set(app: tauri::AppHandle, user_id: String, refresh_token: String) -> Result<(), String> {
    if refresh_token.is_empty() || refresh_token.chars().any(char::is_control) {
        return Err("Invalid secure credential.".to_string());
    }
    let _lock = CREDENTIAL_STORE_LOCK.lock().map_err(|_| "Secure credential store is unavailable.".to_string())?;
    credential_entry(&app, &user_id)?.set_password(&refresh_token).map_err(|_| "Unable to save the secure credential.".to_string())
}

#[tauri::command]
fn secure_credential_delete(app: tauri::AppHandle, user_id: String) -> Result<(), String> {
    let _lock = CREDENTIAL_STORE_LOCK.lock().map_err(|_| "Secure credential store is unavailable.".to_string())?;
    match credential_entry(&app, &user_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Unable to remove the secure credential.".to_string()),
    }
}

fn local_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(LOCAL_SETTINGS_FILE))
        .map_err(|error| format!("Unable to resolve the Rollcasters settings directory: {error}"))
}

#[tauri::command]
fn read_local_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = local_settings_path(&app)?;
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Unable to read Rollcasters local settings: {error}")),
    };
    let settings = serde_json::from_str::<Value>(&contents)
        .map_err(|error| format!("Unable to parse Rollcasters local settings: {error}"))?;
    if !settings.is_object() {
        return Ok(None);
    }
    Ok(Some(settings))
}

#[tauri::command]
fn write_local_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Rollcasters local settings must be a JSON object.".to_string());
    }
    let path = local_settings_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "Unable to resolve the Rollcasters settings directory.".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create the Rollcasters settings directory: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Unable to serialize Rollcasters local settings: {error}"))?;
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Unable to write Rollcasters local settings: {error}"))?;
    if let Err(error) = fs::rename(&temporary_path, &path) {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|remove_error| format!("Unable to replace Rollcasters local settings: {remove_error}"))?;
            fs::rename(&temporary_path, &path)
                .map_err(|rename_error| format!("Unable to replace Rollcasters local settings: {rename_error}"))?;
        } else {
            return Err(format!("Unable to save Rollcasters local settings: {error}"));
        }
    }
    Ok(())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_localhost::Builder::new(1430)
                .host("127.0.0.1")
                .on_request(|_, response| {
                    response.add_header("Access-Control-Allow-Origin", "*");
                    response.add_header("Access-Control-Allow-Methods", "GET, OPTIONS");
                })
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![exit_app, read_local_settings, write_local_settings, secure_credential_get, secure_credential_set, secure_credential_delete])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Rollcasters desktop runtime failed");
}
