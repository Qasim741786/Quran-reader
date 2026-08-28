import { cp, mkdir, rm } from 'node:fs/promises';

const projectFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'service-worker.js',
  'data',
  'assets'
];

await rm('www', { recursive: true, force: true });
await mkdir('www', { recursive: true });

for (const item of projectFiles) {
  await cp(item, `www/${item}`, { recursive: true });
}

// The static app needs Capacitor's JavaScript bridge in addition to the native
// iOS plugins. It is loaded only by the native app at runtime.
await cp('node_modules/@capacitor/core/dist/capacitor.js', 'www/capacitor.js');

console.log('Prepared bundled web assets in www/.');
