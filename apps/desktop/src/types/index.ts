export type DownloadStatus =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'merging'
  | 'processing';

export type DownloadCategory =
  | 'All'
  | 'Videos'
  | 'Music'
  | 'Documents'
  | 'Images'
  | 'Archives'
  | 'Programs'
  | 'Other';

export interface Download {
  id: string;
  url: string;
  original_url: string;
  file_name: string;
  file_path: string;
  directory: string;
  mime_type: string | null;
  file_size: number | null;
  downloaded_size: number;
  status: DownloadStatus;
  download_type: string;
  total_connections: number;
  active_connections: number;
  speed: number;
  average_speed: number;
  eta: number | null;
  error_message: string | null;
  thumbnail?: string | null;
  percentage?: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface DownloadChunk {
  id: string;
  download_id: string;
  chunk_index: number;
  start_byte: number;
  end_byte: number;
  downloaded_bytes: number;
  status: string;
  etag: string | null;
  last_modified: string | null;
  created_at: string;
  updated_at: string;
}

export interface DownloadProgressPayload {
  download_id: string;
  downloaded_size: number;
  file_size: number | null;
  percentage: number;
  speed: number;
  average_speed: number;
  eta: number | null;
  active_connections: number;
  status: DownloadStatus;
}

export interface AddDownloadRequest {
  url: string;
  directory?: string;
  file_name?: string;
  category?: string;
  connections?: number;
  start_immediately?: boolean;
  queue_id?: string;
  speed_limit?: number;
  headers?: Record<string, string>;
  is_media?: boolean;
  audio_url?: string;
}

export interface UrlProbeResult {
  url: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  accept_ranges: boolean;
  suggested_category: string;
  etag: string | null;
  last_modified: string | null;
}

export interface AppSettings {
  default_download_directory: string;
  default_connections: number;
  max_concurrent_downloads: number;
  global_speed_limit: number;
  auto_categorize: boolean;
  category_folders: Record<string, string>;
  duplicate_action: string;
  clipboard_monitor_enabled: boolean;
  notifications_enabled: boolean;
  minimize_to_tray: boolean;
  close_to_tray: boolean;
  theme: string;
  user_agent: string;
  proxy_url?: string;
  retry_count: number;
  retry_delay_seconds: number;
  browser_bridge_port: number;
  browser_bridge_token: string;
  ffmpeg_path?: string;
}

export interface SystemStats {
  total_downloads: number;
  active_downloads: number;
  completed_downloads: number;
  failed_downloads: number;
  current_download_speed: number;
  total_bytes_downloaded: number;
}

export interface FFmpegInfo {
  is_available: boolean;
  version: string | null;
  binary_path: string | null;
}

export interface MediaFormat {
  format_id: string;
  format_note: string | null;
  ext: string;
  resolution: string | null;
  filesize: number | null;
  filesize_approx: number | null;
  tbr: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  has_video: boolean;
  has_audio: boolean;
}

export interface MediaInfo {
  id: string;
  title: string;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  extractor: string;
  formats: MediaFormat[];
}

export interface MediaDownloadRequest {
  url: string;
  format_id: string;
  is_audio_only: boolean;
  directory?: string;
  file_name?: string;
  quality_label?: string;
  thumbnail?: string;
}

export interface ExtractorStatus {
  is_available: boolean;
  binary_path: string | null;
  version: string | null;
}

