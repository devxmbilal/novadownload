use crate::errors::{AppError, AppResult};
use crate::models::DownloadChunk;
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::header::RANGE;
use std::io::SeekFrom;
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc::Sender;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::limiter::RateLimiter;

pub fn partition_chunks(download_id: &str, file_size: i64, num_connections: u32) -> Vec<DownloadChunk> {
    let num = num_connections.max(1) as i64;
    let chunk_size = file_size / num;
    let mut chunks = Vec::new();
    let now = Utc::now();

    for i in 0..num {
        let start = i * chunk_size;
        let end = if i == num - 1 {
            file_size - 1
        } else {
            (i + 1) * chunk_size - 1
        };

        chunks.push(DownloadChunk {
            id: Uuid::new_v4().to_string(),
            download_id: download_id.to_string(),
            chunk_index: i as u32,
            start_byte: start,
            end_byte: end,
            downloaded_bytes: 0,
            status: "pending".to_string(),
            etag: None,
            last_modified: None,
            created_at: now,
            updated_at: now,
        });
    }

    chunks
}

#[derive(Debug, Clone)]
pub enum ChunkProgressMsg {
    BytesRead { chunk_index: u32, bytes: usize },
    ChunkProgress { chunk_index: u32, downloaded_bytes: i64 },
    ChunkCompleted { chunk_index: u32 },
    ChunkFailed { chunk_index: u32, error: String },
}

pub async fn download_chunk_worker(
    client: reqwest::Client,
    url: String,
    headers_map: Option<std::collections::HashMap<String, String>>,
    chunk: DownloadChunk,
    part_filepath: std::path::PathBuf,
    progress_tx: Sender<ChunkProgressMsg>,
    cancel_token: CancellationToken,
    limiter: RateLimiter,
) -> AppResult<()> {
    let chunk_index = chunk.chunk_index;
    let mut current_downloaded = chunk.downloaded_bytes;
    let end_byte = chunk.end_byte;

    let mut retries = 0;
    const MAX_RETRIES: u32 = 8;

    while retries < MAX_RETRIES {
        if cancel_token.is_cancelled() {
            return Err(AppError::Cancelled);
        }

        let current_start = chunk.start_byte + current_downloaded;
        if current_start > end_byte {
            let _ = progress_tx.send(ChunkProgressMsg::ChunkCompleted { chunk_index }).await;
            return Ok(());
        }

        let mut req = client.get(&url);
        req = req.header(RANGE, format!("bytes={}-{}", current_start, end_byte));
        req = req.header("Accept-Encoding", "identity");

        if let Some(ref hdrs) = headers_map {
            for (k, v) in hdrs {
                req = req.header(k, v);
            }
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                retries += 1;
                if retries >= MAX_RETRIES {
                    let _ = progress_tx
                        .send(ChunkProgressMsg::ChunkFailed {
                            chunk_index,
                            error: e.to_string(),
                        })
                        .await;
                    return Err(AppError::Network(e.to_string()));
                }
                tokio::select! {
                    _ = cancel_token.cancelled() => return Err(AppError::Cancelled),
                    _ = tokio::time::sleep(std::time::Duration::from_millis(400 * retries as u64)) => {}
                }
                continue;
            }
        };

        let status = resp.status();
        if !status.is_success() && status.as_u16() != 206 {
            retries += 1;
            if retries >= MAX_RETRIES {
                let err_msg = format!("HTTP error {}", status);
                let _ = progress_tx
                    .send(ChunkProgressMsg::ChunkFailed {
                        chunk_index,
                        error: err_msg.clone(),
                    })
                    .await;
                return Err(AppError::Http {
                    status: status.as_u16(),
                    message: err_msg,
                });
            }
            tokio::select! {
                _ = cancel_token.cancelled() => return Err(AppError::Cancelled),
                _ = tokio::time::sleep(std::time::Duration::from_millis(400 * retries as u64)) => {}
            }
            continue;
        }

        // Open file for random access writing at offset
        let mut file = match OpenOptions::new()
            .create(true)
            .write(true)
            .open(&part_filepath)
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let _ = progress_tx
                    .send(ChunkProgressMsg::ChunkFailed {
                        chunk_index,
                        error: e.to_string(),
                    })
                    .await;
                return Err(AppError::FileSystem(e.to_string()));
            }
        };

        if let Err(e) = file.seek(SeekFrom::Start(current_start as u64)).await {
            let _ = progress_tx
                .send(ChunkProgressMsg::ChunkFailed {
                    chunk_index,
                    error: e.to_string(),
                })
                .await;
            return Err(AppError::FileSystem(e.to_string()));
        }

        let mut stream = resp.bytes_stream();
        let mut stream_failed = false;

        loop {
            let item = tokio::select! {
                _ = cancel_token.cancelled() => {
                    return Err(AppError::Cancelled);
                }
                res = stream.next() => {
                    match res {
                        Some(i) => i,
                        None => break,
                    }
                }
            };

            match item {
                Ok(bytes) => {
                    let len = bytes.len();
                    limiter.acquire(len).await;

                    if let Err(e) = file.write_all(&bytes).await {
                        let _ = progress_tx
                            .send(ChunkProgressMsg::ChunkFailed {
                                chunk_index,
                                error: e.to_string(),
                            })
                            .await;
                        return Err(AppError::FileSystem(e.to_string()));
                    }

                    current_downloaded += len as i64;
                    // Reset retry counter on successful data chunk received
                    retries = 0;

                    let _ = progress_tx
                        .send(ChunkProgressMsg::ChunkProgress {
                            chunk_index,
                            downloaded_bytes: current_downloaded,
                        })
                        .await;
                }
                Err(e) => {
                    tracing::warn!("Chunk {} stream interrupted: {}. Resuming from byte offset...", chunk_index, e);
                    stream_failed = true;
                    break;
                }
            }
        }

        let _ = file.flush().await;

        if stream_failed {
            retries += 1;
            if retries >= MAX_RETRIES {
                let _ = progress_tx
                    .send(ChunkProgressMsg::ChunkFailed {
                        chunk_index,
                        error: "Connection interrupted and maximum retries exceeded".to_string(),
                    })
                    .await;
                return Err(AppError::Network("Connection interrupted and maximum retries exceeded".to_string()));
            }
            tokio::select! {
                _ = cancel_token.cancelled() => return Err(AppError::Cancelled),
                _ = tokio::time::sleep(std::time::Duration::from_millis(400 * retries as u64)) => {}
            }
            continue;
        }

        // If chunk completed
        if chunk.start_byte + current_downloaded >= end_byte {
            let _ = progress_tx.send(ChunkProgressMsg::ChunkCompleted { chunk_index }).await;
            return Ok(());
        }
    }

    let _ = progress_tx.send(ChunkProgressMsg::ChunkCompleted { chunk_index }).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_chunks_even() {
        let chunks = partition_chunks("test-dl-1", 1000, 4);
        assert_eq!(chunks.len(), 4);
        assert_eq!(chunks[0].start_byte, 0);
        assert_eq!(chunks[0].end_byte, 249);
        assert_eq!(chunks[1].start_byte, 250);
        assert_eq!(chunks[1].end_byte, 499);
        assert_eq!(chunks[2].start_byte, 500);
        assert_eq!(chunks[2].end_byte, 749);
        assert_eq!(chunks[3].start_byte, 750);
        assert_eq!(chunks[3].end_byte, 999);
    }

    #[test]
    fn test_partition_chunks_single() {
        let chunks = partition_chunks("test-dl-2", 500, 1);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_byte, 0);
        assert_eq!(chunks[0].end_byte, 499);
    }

    #[test]
    fn test_partition_chunks_uneven() {
        let chunks = partition_chunks("test-dl-3", 100, 3);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].start_byte, 0);
        assert_eq!(chunks[0].end_byte, 32);
        assert_eq!(chunks[1].start_byte, 33);
        assert_eq!(chunks[1].end_byte, 65);
        assert_eq!(chunks[2].start_byte, 66);
        assert_eq!(chunks[2].end_byte, 99);
    }
}

