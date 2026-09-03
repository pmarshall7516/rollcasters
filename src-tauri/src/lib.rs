use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![exit_app])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Rollcasters desktop runtime failed");
}
