pub mod commands;
pub mod models;
pub mod storage;

use commands::{new_file, open_file, save_file};
use tauri::{menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder}, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![open_file, save_file, new_file])
        .setup(|app| {
            // Register Cmd+N/O/S as native menu items so macOS dispatches them
            // reliably (WKWebView doesn't always propagate Cmd+key to JS).
            let new_item = MenuItemBuilder::with_id("new_file", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open_item = MenuItemBuilder::with_id("open_file", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save_item = MenuItemBuilder::with_id("save_file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_item)
                .item(&open_item)
                .item(&save_item)
                .build()?;

            let menu = MenuBuilder::new(app).item(&file_menu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let event_name = match event.id().as_ref() {
                    "new_file" => "menu:new_file",
                    "open_file" => "menu:open_file",
                    "save_file" => "menu:save_file",
                    _ => return,
                };
                let _ = app.emit(event_name, ());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
