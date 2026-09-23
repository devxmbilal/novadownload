import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'apps', 'desktop');

const action = process.argv[2] || 'dev';
const extraArgs = process.argv.slice(3);

const userProfile = process.env.USERPROFILE || os.homedir();
const cargoBin = path.join(userProfile, '.cargo', 'bin');
const llvmBin = 'C:\\Program Files\\LLVM\\bin';
const msvcLibs = path.join(rootDir, 'msvc_libs');
const msvcInclude = path.join(rootDir, 'msvc_include');

// Augment environment with Cargo, LLVM, and local MSVC toolchain
const pathSeparator = path.delimiter;
const existingPath = process.env.PATH || '';
const newPath = [cargoBin, llvmBin, existingPath].filter(Boolean).join(pathSeparator);

const env = {
  ...process.env,
  PATH: newPath,
  CC: process.env.CC || 'clang-cl',
  CXX: process.env.CXX || 'clang-cl',
  LIB: process.env.LIB || msvcLibs,
  INCLUDE: process.env.INCLUDE || msvcInclude,
};

console.log(`[NovaDownload] Running Tauri CLI with action: ${action}`);
console.log(`[NovaDownload] Cargo path: ${cargoBin}`);
console.log(`[NovaDownload] Working directory: ${desktopDir}\n`);

const child = spawn(
  process.platform === 'win32' ? 'cmd.exe' : 'npx',
  process.platform === 'win32' ? ['/c', 'npx', 'tauri', action, ...extraArgs] : ['tauri', action, ...extraArgs],
  {
    cwd: desktopDir,
    env,
    stdio: 'inherit',
    shell: false,
  }
);

child.on('error', (err) => {
  console.error('[NovaDownload] Failed to spawn Tauri process:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
