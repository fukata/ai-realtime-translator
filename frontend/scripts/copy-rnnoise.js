#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  console.log(`[copy] ${src} -> ${dst}`);
}

async function main() {
  const pkgPath = '@shiguredo/rnnoise-wasm/dist/rnnoise.js';
  let src;
  try {
    // Node >=20 supports import.meta.resolve
    const resolved = await import.meta.resolve(pkgPath);
    src = url.fileURLToPath(resolved);
  } catch (e) {
    // Fall back to common locations
    const candidates = [
      path.resolve(process.cwd(), 'node_modules', pkgPath.replace('/dist/rnnoise.js', ''), 'dist', 'rnnoise.js'),
      path.resolve(root, '..', 'node_modules', '@shiguredo', 'rnnoise-wasm', 'dist', 'rnnoise.js'),
      path.resolve(root, 'node_modules', '@shiguredo', 'rnnoise-wasm', 'dist', 'rnnoise.js'),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
      console.error('[copy] could not resolve', pkgPath, 'tried:', candidates);
      process.exit(1);
    }
    src = found;
  }
  const dstPublic = path.join(root, 'public', 'vendor', 'rnnoise.js');
  copyFile(src, dstPublic);
}

main().catch((e) => { console.error(e); process.exit(1); });
