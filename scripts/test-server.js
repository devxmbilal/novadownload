// Development Test HTTP Server for NovaDownload
// Supports: Large files, Range requests (206 Partial Content), Slow download throttling, Simulated network failures, ETags

const http = require('http');

const PORT = 8088;

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1:8088'}`);
  const pathname = reqUrl.pathname;

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'NovaDownload-TestServer' }));
    return;
  }

  // 2. Sample small file (1 MB)
  if (pathname === '/files/small.zip') {
    serveVirtualFile(req, res, 'small.zip', 1024 * 1024, 'application/zip');
    return;
  }

  // 3. Sample large video file (100 MB)
  if (pathname === '/files/video.mp4') {
    serveVirtualFile(req, res, 'sample_video.mp4', 100 * 1024 * 1024, 'video/mp4');
    return;
  }

  // 4. Sample multi-gigabyte file (1 GB)
  if (pathname === '/files/large.iso') {
    serveVirtualFile(req, res, 'ubuntu-linux.iso', 1024 * 1024 * 1024, 'application/x-iso9660-image');
    return;
  }

  // 5. Throttled slow file (10 MB, sent in small chunks)
  if (pathname === '/files/slow.dat') {
    serveThrottledFile(req, res, 'slow_data.dat', 10 * 1024 * 1024, 256 * 1024); // 256 KB/s
    return;
  }

  // 6. Failing endpoint (aborts after 5 MB)
  if (pathname === '/files/failing.bin') {
    serveFailingFile(req, res, 'failing_file.bin', 50 * 1024 * 1024, 5 * 1024 * 1024);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

function serveVirtualFile(req, res, filename, totalSize, mimeType) {
  const etag = `"nova-test-${totalSize}"`;
  const lastModified = 'Wed, 23 Sep 2026 12:00:00 GMT';

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModified);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', mimeType);

  if (req.method === 'HEAD') {
    res.setHeader('Content-Length', totalSize);
    res.writeHead(200);
    res.end();
    return;
  }

  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    // Parse Range: bytes=start-end
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Content-Length': chunkSize,
      });

      // Stream deterministic byte patterns
      streamDeterministicBytes(res, start, end);
      return;
    }
  }

  // Full response
  res.writeHead(200, {
    'Content-Length': totalSize,
  });
  streamDeterministicBytes(res, 0, totalSize - 1);
}

function serveThrottledFile(req, res, filename, totalSize, bytesPerSecond) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', totalSize);
  res.writeHead(200);

  let sent = 0;
  const chunkSize = Math.min(32768, bytesPerSecond);
  const intervalMs = Math.round((chunkSize / bytesPerSecond) * 1000);

  const timer = setInterval(() => {
    if (sent >= totalSize || res.destroyed) {
      clearInterval(timer);
      if (!res.destroyed) res.end();
      return;
    }
    const currentChunk = Math.min(chunkSize, totalSize - sent);
    const buf = Buffer.alloc(currentChunk, 65 + (sent % 26)); // Fill with letters
    res.write(buf);
    sent += currentChunk;
  }, intervalMs);

  req.on('close', () => clearInterval(timer));
}

function serveFailingFile(req, res, filename, totalSize, failAtByte) {
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', totalSize);
  res.writeHead(200);

  let sent = 0;
  const chunkSize = 65536;
  const timer = setInterval(() => {
    if (sent >= failAtByte) {
      clearInterval(timer);
      res.destroy(new Error('Simulated network connection drop'));
      return;
    }
    const currentChunk = Math.min(chunkSize, failAtByte - sent);
    const buf = Buffer.alloc(currentChunk, 88);
    res.write(buf);
    sent += currentChunk;
  }, 50);

  req.on('close', () => clearInterval(timer));
}

function streamDeterministicBytes(res, start, end) {
  const total = end - start + 1;
  let sent = 0;
  const chunkSize = 65536;

  function push() {
    while (sent < total) {
      const len = Math.min(chunkSize, total - sent);
      const buf = Buffer.alloc(len, (start + sent) % 256);
      const ok = res.write(buf);
      sent += len;
      if (!ok) {
        res.once('drain', push);
        return;
      }
    }
    res.end();
  }

  push();
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[NovaDownload Test Server] Running at http://127.0.0.1:${PORT}`);
  console.log(`- 1 MB file:    http://127.0.0.1:${PORT}/files/small.zip`);
  console.log(`- 100 MB video: http://127.0.0.1:${PORT}/files/video.mp4`);
  console.log(`- 1 GB ISO:     http://127.0.0.1:${PORT}/files/large.iso`);
  console.log(`- Slow 10 MB:   http://127.0.0.1:${PORT}/files/slow.dat`);
  console.log(`- Failing:      http://127.0.0.1:${PORT}/files/failing.bin`);
});
