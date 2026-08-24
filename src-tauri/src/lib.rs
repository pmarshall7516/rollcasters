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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("Rollcasters desktop runtime failed");
}
