// Test 1: WAL Safety
// Spawn 5 concurrent worker processes writing 100 pointers each.
// Assert 500 pointers exist with zero SQLITE_BUSY failures.
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { PointerStore } from '../src/store/PointerStore.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const workerScript = join(__dirname, 'wal_worker.ts');
// tsx is hoisted to root node_modules in the monorepo workspace
const tsxBin = join(__dirname, '../../../node_modules/.bin/tsx');

async function runWorker(projectRoot: string, workerId: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsxBin, [workerScript, projectRoot, workerId], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', code => resolve({ code: code ?? 1, stderr }));
    child.on('error', reject);
  });
}

const tmpDir = makeTmpDir();
try {
  console.error('[test_wal_safety] Spawning 5 workers, 100 pointers each...');
  const workers = ['w1', 'w2', 'w3', 'w4', 'w5'];
  const results = await Promise.all(workers.map(id => runWorker(tmpDir, id)));

  for (const [i, result] of results.entries()) {
    assert(result.code === 0, `Worker w${i + 1} exited with code ${result.code}. stderr: ${result.stderr}`);
    assert(!result.stderr.includes('SQLITE_BUSY'), `Worker w${i + 1} got SQLITE_BUSY error`);
    assert(!result.stderr.includes('Error'), `Worker w${i + 1} got error: ${result.stderr}`);
  }

  const store = PointerStore.open(tmpDir);
  const count = store.countPointers();
  assert(count === 500, `Expected 500 pointers, got ${count}`);

  console.error('[test_wal_safety] PASS: 500 pointers written, zero SQLITE_BUSY failures');
} finally {
  cleanTmpDir(tmpDir);
}
