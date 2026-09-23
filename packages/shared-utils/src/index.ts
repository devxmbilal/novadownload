import { DownloadCategory } from '@novadownload/shared-types';

export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const clampedI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, clampedI)).toFixed(dm))} ${sizes[clampedI]}`;
}

export function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function sanitizeFileName(name: string): string {
  // Remove invalid file path characters on Windows and Unix
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getCategoryFromFilename(fileName: string, mimeType?: string | null): DownloadCategory {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const videoExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', '3gp', 'ts'];
  const musicExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'];
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'md', 'epub'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'avif'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'tgz'];
  const programExts = ['exe', 'msi', 'bat', 'sh', 'apk', 'appimage', 'deb', 'rpm'];

  if (videoExts.includes(ext) || (mimeType && mimeType.startsWith('video/'))) {
    return 'Videos';
  }
  if (musicExts.includes(ext) || (mimeType && mimeType.startsWith('audio/'))) {
    return 'Music';
  }
  if (docExts.includes(ext) || (mimeType && (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('sheet')))) {
    return 'Documents';
  }
  if (imageExts.includes(ext) || (mimeType && mimeType.startsWith('image/'))) {
    return 'Images';
  }
  if (archiveExts.includes(ext) || (mimeType && (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar') || mimeType.includes('archive')))) {
    return 'Archives';
  }
  if (programExts.includes(ext) || (mimeType && (mimeType.includes('executable') || mimeType.includes('octet-stream') && (ext === 'exe' || ext === 'msi')))) {
    return 'Programs';
  }

  return 'Other';
}
