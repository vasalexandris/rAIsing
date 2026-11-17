import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('extension/dist', { recursive: true, force: true });
mkdirSync('extension/dist', { recursive: true });

await build({
  entryPoints: {
    claude: 'extension/src/claude.ts',
    bridge: 'extension/src/bridge.ts',
    background: 'extension/src/background.ts',
  },
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  outdir: 'extension/dist',
  logLevel: 'info',
});
cpSync('extension/manifest.json', 'extension/dist/manifest.json');
