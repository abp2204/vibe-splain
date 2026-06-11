import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

// Bundle CLI with brain inlined. tsc already compiled everything,
// now esbuild resolves @vibe-splain/brain imports from ../brain/dist/
await build({
  entryPoints: ['dist/index.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  allowOverwrite: true,
  // Keep all npm packages external — only inline @vibe-splain/brain
  external: [
    '@modelcontextprotocol/sdk',
    'async-mutex',
    'chokidar',
    'commander',
    'fs-extra',
    'tree-sitter-wasms',
    'uuid',
    'web-tree-sitter',
  ],
});

// Ensure shebang is on line 1
const content = readFileSync('dist/index.js', 'utf8');
const shebang = '#!/usr/bin/env node\n';
const cleaned = content.replace(/^#!.*\n/gm, '');
writeFileSync('dist/index.js', shebang + cleaned);

console.error('[esbuild] Bundled CLI with brain inlined');
