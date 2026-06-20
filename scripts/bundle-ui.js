const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');
const src = join(__dirname, '..', 'packages', 'ui', 'dist');
const dest = join(__dirname, '..', 'packages', 'cli', 'dist', 'ui');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.error('[bundle-ui] Copied UI bundle to packages/cli/dist/ui/');
