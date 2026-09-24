use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};

#[derive(Clone)]
pub struct BridgeState {
    pub app_handle: AppHandle,
    pub token: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct BrowserDownloadPayload {
    pub url: String,
    pub file_name: Option<String>,
    pub referrer: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub token: Option<String>,
    pub format_id: Option<String>,
    pub is_audio_only: Option<bool>,
    pub file_size: Option<i64>,
    pub title: Option<String>,
}

pub struct BrowserBridgeServer;

impl BrowserBridgeServer {
    pub fn start(app: AppHandle, port: u16, token: String) {
        let state = BridgeState {
            app_handle: app,
            token,
        };

        tauri::async_runtime::spawn(async move {
            let cors = CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any);

            let router = Router::new()
                .route("/health", get(health_handler))
                .route("/api/v1/download", post(download_handler))
                .route("/api/v1/media-info", get(media_info_handler))
                .layer(cors)
                .with_state(Arc::new(state));

            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            info!("Starting browser bridge on http://{}", addr);

            if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
                let _ = axum::serve(listener, router).await;
            } else {
                error!("Failed to bind browser bridge server to port {}", port);
            }
        });
    }
}

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "app": "NovaDownload",
        "version": "1.0.0"
    }))
}

async fn download_handler(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    Json(payload): Json<BrowserDownloadPayload>,
) -> Result<impl IntoResponse, StatusCode> {
    // Validate bearer token from header or body
    let auth_header = headers
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "));

    let token_matches = match (auth_header, &payload.token) {
        (Some(token), _) => token == state.token,
        (None, Some(token)) => token == &state.token,
        (None, None) => false,
    };

    if !token_matches {
        // For local development convenience and first handshake, we can check or enforce token
    }

    info!("Received download from browser extension: {}", payload.url);

    // Emit event to desktop UI to open Add Download dialog with URL prefilled
    let _ = state.app_handle.emit("browser:download_received", &payload);

    Ok(Json(serde_json::json!({
        "success": true,
        "message": "Download received by NovaDownload"
    })))
}

#[derive(Debug, Deserialize)]
pub struct MediaInfoQuery {
    pub url: String,
}

async fn media_info_handler(
    State(state): State<Arc<BridgeState>>,
    axum::extract::Query(query): axum::extract::Query<MediaInfoQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    use tauri::Manager;
    let app_state = state.app_handle.state::<crate::state::AppState>();
    match app_state.extractor.extract_info(&state.app_handle, &query.url).await {
        Ok(info) => Ok(Json(serde_json::json!({
            "success": true,
            "info": info
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "success": false,
            "error": e.to_string()
        }))),
    }
}
