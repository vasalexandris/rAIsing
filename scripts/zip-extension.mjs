import { zipSync } from 'fflate';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Packs extension/dist into dist/raising-extension.zip so it can be downloaded from the live site.
const dir = 'extension/dist';
const files = {};
for (const name of readdirSync(dir)) files[name] = readFileSync(`${dir}/${name}`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/raising-extension.zip', zipSync(files));
console.log('dist/raising-extension.zip written (' + Object.keys(files).join(', ') + ')');
