mod db;
mod helper;
#[cfg(windows)]
mod webview2;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

#[derive(Default)]
struct Flags {
    keep_in_tray: AtomicBool,
}
#[derive(Default)]
struct TrayHandle(Mutex<Option<TrayIcon>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    version: String,
    data_folder: String,
    data_file: String,
    portable: bool,
    runtime: String,
    developer: bool,
}

fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default()
}
/// The installer puts uninstall.exe beside the program; without it the program is the portable copy.
fn is_portable() -> bool {
    !exe_dir().join("uninstall.exe").exists()
}
/// Portable: the data stays beside the program. Installed: in the user's app data (the same place the
/// earlier Electron version used, so an update keeps the cheque list).
fn data_folder(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CW_DATA_DIR") {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        return Ok(path.into());
    }
    let installed = app.path().config_dir().map_err(|e| e.to_string())?.join("SJMR Cheque Writer").join("data");
    let folder = if is_portable() { exe_dir().join("SJMR Cheque Writer Data") } else { installed.clone() };
    if std::fs::create_dir_all(&folder).is_ok() {
        return Ok(folder);
    }
    std::fs::create_dir_all(&installed).map_err(|e| format!("The data folder cannot be created: {e}"))?;
    Ok(installed)
}

#[tauri::command]
fn app_info(app: AppHandle) -> Result<Info, String> {
    let folder = data_folder(&app)?;
    Ok(Info {
        version: app.package_info().version.to_string(),
        data_file: folder.join("cheque_writer_data.db").to_string_lossy().into_owned(),
        data_folder: folder.to_string_lossy().into_owned(),
        portable: is_portable(),
        runtime: format!("Tauri {}", tauri::VERSION),
        // Developer options exist only on a PC where this variable is set to 1; a normal user cannot switch them on.
        developer: std::env::var("SJMR_CW_DEVELOPER").map(|v| v == "1").unwrap_or(false),
    })
}

#[tauri::command]
fn write_base64(path: String, base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim()).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let folder = data_folder(&app)?;
    #[cfg(windows)]
    let opener = "explorer";
    #[cfg(not(windows))]
    let opener = "xdg-open";
    std::process::Command::new(opener).arg(folder).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Restore: close the open file, keep the current data as a safety copy, put the chosen copy in its place, restart.
#[tauri::command]
fn replace_data_file(app: AppHandle, dbs: State<'_, db::Dbs>, source: String) -> Result<(), String> {
    let folder = data_folder(&app)?;
    let file = folder.join("cheque_writer_data.db");
    dbs.close_all();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    if file.exists() {
        std::fs::copy(&file, folder.join(format!("before-restore-{stamp}.db"))).map_err(|e| e.to_string())?;
    }
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{}", file.display(), suffix));
    }
    std::fs::copy(&source, &file).map_err(|e| e.to_string())?;
    app.restart()
}

#[tauri::command]
fn set_tray(app: AppHandle, flags: State<'_, Flags>, tray: State<'_, TrayHandle>, keep_in_tray: Option<bool>, tip: Option<String>) -> Result<(), String> {
    let _ = &app;
    if let Some(keep) = keep_in_tray {
        flags.keep_in_tray.store(keep, Ordering::SeqCst);
    }
    if let (Some(text), Ok(guard)) = (tip, tray.0.lock()) {
        if let Some(icon) = guard.as_ref() {
            icon.set_tooltip(Some(text)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Start-up check used by the build pipeline: with CW_SMOKE=1 the window reports what it shows, then the program ends.
#[tauri::command]
fn smoke_env() -> Option<String> {
    if std::env::var("CW_SMOKE").ok().as_deref() == Some("1") {
        Some(std::env::var("CW_SMOKE_OUT").unwrap_or_default())
    } else {
        None
    }
}

#[tauri::command]
fn smoke_done(app: AppHandle, text: String) {
    if let Ok(file) = std::env::var("CW_SMOKE_OUT") {
        if !file.is_empty() {
            let _ = std::fs::write(file, &text);
        }
    }
    println!("{text}");
    app.exit(0);
}

fn show(app: &AppHandle, target: Option<&str>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(target) = target {
        let _ = app.emit("cw:navigate", target);
    }
}

pub fn run() {
    #[cfg(windows)]
    webview2::ensure_or_exit();
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app, None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(db::Dbs::default())
        .manage(Flags::default())
        .manage(TrayHandle::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            db::db_open,
            db::db_close,
            db::db_exec,
            db::db_all,
            helper::run_helper,
            write_base64,
            remove_file,
            open_data_folder,
            replace_data_file,
            set_tray,
            smoke_env,
            smoke_done
        ])
        .setup(move |app| {
            let open = MenuItem::with_id(app, "open", "Open SJMR Cheque Writer", true, None::<&str>)?;
            let list = MenuItem::with_id(app, "list", "Cheque list", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &list, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut builder = TrayIconBuilder::new()
                .tooltip("SJMR Cheque Writer")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app, None),
                    "list" => show(app, Some("cheques")),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show(tray.app_handle(), None);
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            let tray = builder.build(app)?;
            *app.state::<TrayHandle>().0.lock().unwrap() = Some(tray);
            if !hidden {
                show(app.handle(), None);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = window.app_handle().state::<Flags>().keep_in_tray.load(Ordering::SeqCst);
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("SJMR Cheque Writer could not start");
}
