import { defineConfig, Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

function generateFirefoxManifestPlugin(): Plugin {
  return {
    name: 'generate-firefox-manifest',
    closeBundle() {
      const manifest = {
        manifest_version: 2,
        name: 'NovaDownload Integration',
        version: '1.1.0',
        description: 'Send downloads and media streams directly to NovaDownload Desktop Accelerator.',
        permissions: [
          'contextMenus',
          'activeTab',
          'storage',
          'downloads',
          'notifications',
          'http://127.0.0.1:64123/*',
          'http://localhost:64123/*',
          '<all_urls>',
        ],
        background: {
          scripts: ['assets/background.js'],
        },
        browser_action: {
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
            all_frames: true,
            match_about_blank: true,
          },
        ],
        web_accessible_resources: ['icons/*'],
      };

      const outDir = path.resolve(__dirname, 'dist/firefox');
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
  plugins: [generateFirefoxManifestPlugin()],
  build: {
    outDir: 'dist/firefox',
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
