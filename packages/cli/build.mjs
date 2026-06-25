import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

// Bundle CLI with brain inlined. tsc already compiled everything,
// now esbuild resolves @vibesplain/brain imports from ../brain/dist/
await build({
  entryPoints: ['dist/index.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  allowOverwrite: true,
  // Keep all npm packages external — only inline @vibesplain/brain
  external: [
    '@modelcontextprotocol/sdk',
    'chokidar',
    'commander',
    'fs-extra',
    'tar',
    'tree-sitter-wasms',
    'web-tree-sitter',
  ],
});

// Ensure shebang is on line 1 for CLI entrypoint
const content = readFileSync('dist/index.js', 'utf8');
const shebang = '#!/usr/bin/env node\n';
const cleaned = content.replace(/^#!.*\n/gm, '');
writeFileSync('dist/index.js', shebang + cleaned);

console.error('[esbuild] Bundled CLI with brain inlined');
