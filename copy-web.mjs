/* Copies the web app into www/, which is what Capacitor bundles into the APK.
   Run via `npm run copy`. */

import { mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const out  = join(root, 'www');

// sw.js is deliberately absent: the assets are already local inside the APK,
// and a cache-first worker would serve stale files after an app update.
// script.js catches the failed registration.
const FILES = [
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'icon-apple-180.png'
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let n = 0;
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) {
    console.error(`missing: ${f}`);
    process.exitCode = 1;
    continue;
  }
  await copyFile(src, join(out, f));
  n++;
}
console.log(`copied ${n} files into www/`);
