import { copyFile } from 'node:fs/promises';
await copyFile('src/desktop/preload.cjs', 'dist/main/desktop/preload.cjs');
