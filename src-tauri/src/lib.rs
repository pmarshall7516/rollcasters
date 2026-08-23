fn validate_session_identity(service: &str, account: &str) -> Result<(), String> {
    const SERVICES: [&str; 2] = ["com.rollcasters.local", "com.rollcasters.game"];
    if !SERVICES.contains(&service) || account != format!("{service}.auth") {
        return Err("Invalid Rollcasters credential namespace.".into());
    }
    Ok(())
}

#[tauri::command]
fn session_get(service: String, account: String) -> Result<Option<String>, String> {
    validate_session_identity(&service, &account)?;
    let entry = keyring::Entry::new(&service, &account).map_err(|_| "Credential store unavailable.".to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Credential store read failed.".into()),
    }
}

#[tauri::command]
fn session_set(service: String, account: String, value: String) -> Result<(), String> {
    validate_session_identity(&service, &account)?;
    if value.len() > 128 * 1024 {
        return Err("Credential payload exceeds the supported size.".into());
    }
    keyring::Entry::new(&service, &account)
        .map_err(|_| "Credential store unavailable.".to_string())?
        .set_password(&value)
        .map_err(|_| "Credential store write failed.".to_string())
}

#[tauri::command]
fn session_delete(service: String, account: String) -> Result<(), String> {
    validate_session_identity(&service, &account)?;
    let entry = keyring::Entry::new(&service, &account).map_err(|_| "Credential store unavailable.".to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Credential store delete failed.".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![session_get, session_set, session_delete])
        .run(tauri::generate_context!())
        .expect("Rollcasters desktop runtime failed");
}
