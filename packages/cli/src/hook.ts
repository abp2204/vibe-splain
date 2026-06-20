import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { decidePreToolUse, type PreToolUseInput } from './hook/preToolUse.js';

export function findProjectRoot(start: string | undefined): string | null {
  let dir = start || process.cwd();
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.vibe-splainer'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  const rawStdin = await readStdin();
  let input: PreToolUseInput;
  try {
    input = JSON.parse(rawStdin);
  } catch {
    process.exit(0);
  }

  const root = findProjectRoot(input.cwd);
  const gatePath = root ? join(root, '.vibe-splainer', 'gate.json') : null;
  const gateExists = gatePath ? existsSync(gatePath) : false;

  let result;
  if (!gateExists) {
    const sessionId = input.session_id || 'default';
    const warnFile = join(tmpdir(), `vibe-splain-warn-${sessionId}`);
    const warningShown = existsSync(warnFile);
    
    result = decidePreToolUse(input, null, { warningShown });
    
    if (result.action === 'emit') {
      try {
        writeFileSync(warnFile, '1');
      } catch {
        // Ignore write failures
      }
    }
  } else {
    let gateIndex = null;
    try {
      gateIndex = JSON.parse(readFileSync(gatePath!, 'utf8'));
    } catch {
      // If parsing fails, treat it as missing/corrupted
    }
    result = decidePreToolUse(input, gateIndex);
  }

  if (result.action === 'emit') {
    process.stdout.write(JSON.stringify(result.output));
  }
  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
