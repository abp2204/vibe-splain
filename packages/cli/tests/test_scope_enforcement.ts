// Test 4: Scope Enforcement
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { SessionScope, ScopeViolation } from '../src/mcp/SessionScope.js';
import { handleGetFileSkeleton } from '../src/mcp/tools/get_file_skeleton.js';
import { handleYieldForScopeExpansion } from '../src/mcp/tools/yield_for_scope_expansion.js';
import { PointerStore } from '../src/store/PointerStore.js';

const tmpDir = makeTmpDir();
try {
  // Create test files
  const srcDir = join(tmpDir, 'src');
  await mkdir(srcDir, { recursive: true });
  await writeFile(join(srcDir, 'safe.ts'), 'export const safe = true;\n', 'utf8');
  await writeFile(join(srcDir, 'secret.ts'), 'export const secret = true;\n', 'utf8');

  // Set up a work order with restricted scope
  const pointerStore = PointerStore.open(tmpDir);
  await pointerStore.insertWorkOrder({
    workOrderId: 'wo_scope_test',
    intent: 'scope enforcement test',
    allowedFiles: JSON.stringify(['src/safe.ts']),
    allowedGlobs: JSON.stringify([]),
    deniedGlobs: JSON.stringify([]),
    requiredProof: JSON.stringify([]),
    status: 'active',
    createdAt: Date.now(),
  });

  // --- Test 4a: Boundary Violation ---

  // 1. Call set_session_scope with allowedFiles: ['src/safe.ts']
  SessionScope.set({
    workOrderId: 'wo_scope_test',
    allowedFiles: ['src/safe.ts'],
    allowedGlobs: [],
    deniedGlobs: [],
    requiredProof: [],
  });

  // 2. Call get_file_skeleton on src/secret.ts — must throw ScopeViolation
  let threw = false;
  try {
    await handleGetFileSkeleton({
      projectRoot: tmpDir,
      filePath: 'src/secret.ts',
      scanId: 'scan_scope_test',
    });
  } catch (e) {
    if (e instanceof ScopeViolation) {
      threw = true;
      assert(e.path === 'src/secret.ts', `ScopeViolation.path should be src/secret.ts, got: ${e.path}`);
      assert(e.workOrderId === 'wo_scope_test', `ScopeViolation.workOrderId mismatch: ${e.workOrderId}`);
    } else {
      throw e;
    }
  }
  assert(threw, 'Expected ScopeViolation for src/secret.ts but no error thrown');
  console.error('[test_scope_enforcement] PASS 4a: ScopeViolation thrown for out-of-scope path');

  // 3. Verify that src/safe.ts is accessible
  const safeResult = await handleGetFileSkeleton({
    projectRoot: tmpDir,
    filePath: 'src/safe.ts',
    scanId: 'scan_scope_test',
  }) as Record<string, unknown>;
  assert('filePath' in safeResult || 'pointerId' in safeResult, 'src/safe.ts should be accessible');
  console.error('[test_scope_enforcement] PASS: src/safe.ts accessible within scope');

  // --- Test 4b: Yielding ---

  // Worker calls yield_for_scope_expansion
  const yieldResult = await handleYieldForScopeExpansion({
    requestedPaths: ['src/secret.ts'],
    reason: 'Root cause found in secret.ts — need read access to diagnose',
    evidencePointers: ['ptr_some_evidence'],
  }) as Record<string, unknown>;

  // Assert: status === 'blocked' and valid receipt structure
  assert(yieldResult.status === 'blocked', `Expected status: blocked, got: ${yieldResult.status}`);
  assert('receipt' in yieldResult, 'Yield result must have receipt');
  const receipt = yieldResult.receipt as Record<string, unknown>;
  assert(receipt.status === 'blocked', `Receipt status should be blocked, got: ${receipt.status}`);
  assert('workOrderId' in receipt, 'Receipt must have workOrderId');
  assert('summary' in receipt, 'Receipt must have summary');
  assert(Array.isArray(receipt.proofPointers), 'Receipt must have proofPointers array');
  assert(Array.isArray(receipt.changedFiles), 'Receipt must have changedFiles array');

  // Scope should be cleared after yield
  assert(SessionScope.get() === null, 'Scope should be cleared after yield_for_scope_expansion');

  console.error('[test_scope_enforcement] PASS 4b: yield_for_scope_expansion returns status:blocked with valid receipt');
} finally {
  SessionScope.clear();
  cleanTmpDir(tmpDir);
}
