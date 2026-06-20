// `vibe-splain hook pretooluse` — the deterministic PreToolUse gate, wired to stdio.
//
// Claude Code pipes a JSON describing the tool call about to run onto stdin; we
// decide whether to escalate and, if so, write hook JSON to stdout. On a safe
// edit (or any non-edit tool, unscanned repo, etc.) we print nothing and exit 0,
// deferring to normal permission flow.
//
// NOTE on the console.log ban: that rule protects the MCP *server's* stdout.
// This is a separate, short-lived process whose stdout IS the hook protocol —
// writing JSON here is correct. Diagnostics still go to stderr.

import { existsSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import type { GateIndex } from '@vibe-splain/brain';
import { decidePreToolUse, type PreToolUseInput } from '../hook/preToolUse.js';

export interface HookCommandResult {
  /** JSON to print to stdout, or null to print nothing (defer / exit 0). */
  stdout: string | null;
}

// Walk up from `start` looking for the directory that holds a `.vibe-splainer` scan.
// Returns null if none is found — an unscanned repo means the gate is inert.
export function findProjectRoot(start: string | undefined): string | null {
  let dir = start || process.cwd();
  // Bound the walk so a stray cwd can't traverse the whole filesystem.
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, '.vibe-splainer', 'analysis.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Pure-ish core: raw stdin string in, hook decision (as a string or null) out. */
export async function runHookCommand(rawStdin: string): Promise<HookCommandResult> {
  let input: PreToolUseInput;
  try {
    input = JSON.parse(rawStdin);
  } catch {
    return { stdout: null }; // malformed input → never block the agent
  }

  const root = findProjectRoot(input.cwd);
  const gatePath = root ? join(root, '.vibe-splainer', 'gate.json') : null;
  const gateExists = gatePath ? existsSync(gatePath) : false;

  let gateIndex: GateIndex | null = null;
  if (gateExists) {
    try {
      gateIndex = JSON.parse(readFileSync(gatePath!, 'utf8'));
    } catch {}
  }

  const sessionId = input.session_id || 'default';
  const warnFile = join(tmpdir(), `vibe-splain-warn-${sessionId}`);
  const warningShown = existsSync(warnFile);

  const result = decidePreToolUse(input, gateIndex, { warningShown });
  if (result.action === 'defer') return { stdout: null };
  if (!gateIndex && result.action === 'emit') {
    try {
      writeFileSync(warnFile, '1');
    } catch {}
  }
  return { stdout: JSON.stringify(result.output) };
}

/** CLI entrypoint: read all of stdin, run the gate, emit the result. */
export async function hookPreToolUseCommand(): Promise<void> {
  const raw = await readStdin();
  const { stdout } = await runHookCommand(raw);
  if (stdout) process.stdout.write(stdout);
  // No stdout on defer; exit code stays 0.
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}
