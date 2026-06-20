import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PointerStore } from '../src/store/PointerStore.js';

export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'vibe-test-'));
}

export function cleanTmpDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
  PointerStore.reset();
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

export function assertThrows(fn: () => unknown, errorName: string): void {
  try {
    fn();
    throw new Error(`ASSERT FAILED: expected ${errorName} to be thrown, but no error was thrown`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('ASSERT FAILED')) throw e;
    if (e instanceof Error && e.name !== errorName && !e.message.includes(errorName)) {
      throw new Error(`ASSERT FAILED: expected ${errorName}, got ${e.name}: ${e.message}`);
    }
  }
}

export async function assertThrowsAsync(fn: () => Promise<unknown>, errorSubstring: string): Promise<void> {
  try {
    await fn();
    throw new Error(`ASSERT FAILED: expected error containing "${errorSubstring}", but no error was thrown`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('ASSERT FAILED')) throw e;
    if (e instanceof Error && !e.message.includes(errorSubstring)) {
      throw new Error(`ASSERT FAILED: expected error containing "${errorSubstring}", got: ${e.message}`);
    }
  }
}
