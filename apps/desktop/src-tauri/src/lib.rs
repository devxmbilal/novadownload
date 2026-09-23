pub mod browser;
pub mod commands;
pub mod database;
pub mod downloader;
pub mod errors;
pub mod ffmpeg;
pub mod filesystem;
pub mod models;
pub mod notifications;
pub mod queue;
pub mod scheduler;
pub mod settings;
pub mod state;

use database::Database;
use downloader::DownloadEngine;
use ffmpeg::FFmpegService;
use notifications::NotificationService;
use queue::QueueManager;
use rusqlite::Connection;
use scheduler::SchedulerService;
use settings::SettingsManager;
use state::AppState;
use std::path::PathBuf;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

pub fn run() {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    let _ = tracing::subscriber::set_global_default(subscriber);

    info!("Starting NovaDownload Core Engine...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Locate app data directory for SQLite
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| {
                    dirs::data_dir()
                        .unwrap_or_else(|| PathBuf::from("."))
                        .join("NovaDownload")
                });
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("novadownload.db");

            info!("Database initialized at: {:?}", db_path);
            let conn = Connection::open(&db_path)?;
            let db = Database::new(conn);

            // Execute async initialization inside tokio runtime
            tauri::async_runtime::block_on(async {
                db.init().await.expect("Failed to initialize database schema");
                
                // Recover any interrupted downloads from past crash
                let recovered = db.recover_interrupted_downloads().await.unwrap_or_default();
                if !recovered.is_empty() {
                    info!("Recovered {} interrupted downloads from previous session", recovered.len());
                }
            });

            let settings_mgr = tauri::async_runtime::block_on(async {
                SettingsManager::new(db.clone()).await
            });

            let engine = DownloadEngine::new(db.clone());
            let queue_mgr = QueueManager::new(db.clone(), engine.clone());
            let scheduler = SchedulerService::new(db.clone(), engine.clone());
            let ffmpeg = FFmpegService::default();
            let notifications = NotificationService::new();

            // Start queue worker & scheduler
            queue_mgr.start_queue_worker(app_handle.clone());
            scheduler.start_scheduler_worker(app_handle.clone());

            // Start browser extension bridge
            let settings = tauri::async_runtime::block_on(settings_mgr.get_settings());
            browser::BrowserBridgeServer::start(
                app_handle.clone(),
                settings.browser_bridge_port,
                settings.browser_bridge_token.clone(),
            );

            // Apply global speed limit
            engine.set_global_speed_limit(settings.global_speed_limit);

            let state = AppState {
                db,
                engine,
                queue_mgr,
                scheduler,
                settings_mgr,
                ffmpeg,
                notifications,
            };

            app.manage(state);

            // Setup System Tray
            let tray_menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "open", "Open NovaDownload", true, None::<&str>)?,
                    &MenuItem::with_id(app, "pause_all", "Pause All", true, None::<&str>)?,
                    &MenuItem::with_id(app, "resume_all", "Resume All", true, None::<&str>)?,
                    &MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?,
                ],
            )?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "pause_all" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = handle.state::<AppState>();
                            let _ = commands::pause_all_downloads(handle.clone(), state).await;
                        });
                    }
                    "resume_all" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = handle.state::<AppState>();
                            let _ = commands::resume_all_downloads(handle.clone(), state).await;
                        });
                    }
                    "exit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let settings = tauri::async_runtime::block_on(state.settings_mgr.get_settings());
                if settings.close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe_url,
            commands::create_download,
            commands::start_download,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::delete_download,
            commands::list_downloads,
            commands::get_download,
            commands::get_download_chunks,
            commands::pause_all_downloads,
            commands::resume_all_downloads,
            commands::get_settings,
            commands::update_settings,
            commands::detect_ffmpeg,
            commands::merge_media,
            commands::extract_audio,
            commands::open_file_or_dir,
            commands::show_in_folder,
            commands::get_system_stats,
            commands::recover_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NovaDownload application");
}
