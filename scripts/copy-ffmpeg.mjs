import { copyFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dest = resolve(root, 'public', 'ffmpeg');

const files = [
  // Use the single-thread ESM core so the module worker used by @ffmpeg/ffmpeg
  // can import it directly in development and production.
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
];

if (!existsSync(dest)) {
  await mkdir(dest, { recursive: true });
}

for (const [src, name] of files) {
  const srcPath = resolve(root, src);
  const destPath = resolve(dest, name);
  await copyFile(srcPath, destPath);
  console.log(`Copied ${name} to public/ffmpeg/`);
}

const staleFiles = ['ffmpeg-core.worker.js'];

for (const name of staleFiles) {
  const destPath = resolve(dest, name);
  if (existsSync(destPath)) {
    await rm(destPath, { force: true });
    console.log(`Removed stale ${name} from public/ffmpeg/`);
  }
}
