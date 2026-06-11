// Test 2: Hash-Guards & Integrity — Stale Patch Rejection
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert, assertThrowsAsync } from './helpers.js';
import { hashFile } from '../src/store/BlobStore.js';
import { handleApplyPatch } from '../src/mcp/tools/apply_patch.js';
import { SessionScope } from '../src/mcp/SessionScope.js';
import { StalePatchError } from '../src/mcp/tools/apply_patch.js';
import { PointerStore } from '../src/store/PointerStore.js';

const tmpDir = makeTmpDir();
try {
  const srcDir = join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });
  const testFile = join(tmpDir, 'src', 'A.ts');

  // Set up a work order so scope allows the file
  const pointerStore = PointerStore.open(tmpDir);
  await pointerStore.insertWorkOrder({
    workOrderId: 'wo_stale_test',
    intent: 'stale patch test',
    allowedFiles: JSON.stringify(['src/A.ts']),
    allowedGlobs: JSON.stringify([]),
    deniedGlobs: JSON.stringify([]),
    requiredProof: JSON.stringify([]),
    status: 'active',
    createdAt: Date.now(),
  });
  SessionScope.set({
    workOrderId: 'wo_stale_test',
    allowedFiles: ['src/A.ts'],
    allowedGlobs: [],
    deniedGlobs: [],
    requiredProof: [],
  });

  // 1. Write initial content and get H1
  await writeFile(testFile, 'export const x = 1;\n', 'utf8');
  const h1 = await hashFile(testFile);
  console.error(`[test_stale_patch] H1 = ${h1}`);

  // 2. Modify the file on disk → H2
  await writeFile(testFile, 'export const x = 2;\n', 'utf8');
  const h2 = await hashFile(testFile);
  assert(h1 !== h2, 'H1 and H2 should differ');

  // 3. Call apply_patch with expectedPrePatchHash: H1 (stale)
  let threw = false;
  try {
    await handleApplyPatch({
      projectRoot: tmpDir,
      filePath: 'src/A.ts',
      newContent: 'export const x = 3;\n',
      expectedPrePatchHash: h1,
      scanId: 'scan_stale_test',
    });
  } catch (e) {
    if (e instanceof StalePatchError) {
      threw = true;
      assert(e.expectedHash === h1, `expectedHash mismatch: ${e.expectedHash}`);
      assert(e.actualHash === h2, `actualHash mismatch: ${e.actualHash}`);
    } else {
      throw e;
    }
  }

  assert(threw, 'Expected StalePatchError to be thrown but no error was thrown');
  console.error('[test_stale_patch] PASS: StalePatchError thrown correctly');
} finally {
  SessionScope.clear();
  cleanTmpDir(tmpDir);
}
