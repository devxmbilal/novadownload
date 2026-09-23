import { defineConfig, Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

function generateManifestPlugin(): Plugin {
  return {
    name: 'generate-manifest',
    closeBundle() {
      const manifest = {
        manifest_version: 3,
        name: 'NovaDownload Integration',
        version: '1.0.0',
        description: 'Send downloads and media streams directly to NovaDownload Desktop Accelerator.',
        permissions: ['contextMenus', 'activeTab', 'storage', 'downloads'],
        host_permissions: [
          'http://127.0.0.1:64123/*',
          'http://localhost:64123/*',
          '<all_urls>',
        ],
        background: {
          service_worker: 'assets/background.js',
          type: 'module',
        },
        action: {
          default_popup: 'src/popup/index.html',
          default_title: 'NovaDownload',
        },
        icons: {
          '16': 'icons/16.png',
          '48': 'icons/48.png',
          '128': 'icons/128.png',
        },
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['assets/content.js'],
            run_at: 'document_idle',
          },
        ],
      };

      const outDir = path.resolve(__dirname, 'dist/chrome');
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(
        path.resolve(outDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );
    },
  };
}

export default defineConfig({
  plugins: [generateManifestPlugin()],
  build: {
    outDir: 'dist/chrome',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/popup/index.html'),
        background: path.resolve(__dirname, 'src/background/index.ts'),
        content: path.resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
