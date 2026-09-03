use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const LOCAL_SETTINGS_FILE: &str = "settings.json";

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
        .invoke_handler(tauri::generate_handler![exit_app, read_local_settings, write_local_settings])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Rollcasters desktop runtime failed");
}
