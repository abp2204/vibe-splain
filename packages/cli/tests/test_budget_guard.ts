// Test 3: Output Discipline — Budget Guard
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { applyBudgetGuard } from '../src/mcp/BudgetGuard.js';
import { PointerStore } from '../src/store/PointerStore.js';

const tmpDir = makeTmpDir();
try {
  // Create a dummy output that exceeds 8000 chars (~2000 tokens)
  const bigOutput = {
    data: 'x'.repeat(5 * 1024 * 1024), // 5 MB string
  };

  const serialized = JSON.stringify(bigOutput);
  assert(serialized.length > 8000, `Expected output > 8000 chars, got ${serialized.length}`);

  // Call BudgetGuard
  const result = await applyBudgetGuard(tmpDir, 'scan_budget_test', 'dummy_tool_output', bigOutput) as Record<string, unknown>;

  // Assert result is a small pointer, NOT the 5MB string
  const resultStr = JSON.stringify(result);
  assert(resultStr.length < 1000, `Result should be a small pointer JSON, got ${resultStr.length} chars`);

  assert('pointerId' in result, 'Result must have pointerId');
  assert('summary' in result, 'Result must have summary');
  assert('contentHash' in result, 'Result must have contentHash');
  assert(typeof result.pointerId === 'string' && (result.pointerId as string).startsWith('ptr_'), `pointerId should start with ptr_, got: ${result.pointerId}`);
  assert(!('data' in result), 'Result must NOT contain the original data');

  // Verify the pointer was registered in PointerStore
  const store = PointerStore.open(tmpDir);
  const pointer = store.getPointer(result.pointerId as string);
  assert(pointer !== null, 'Pointer should be findable in PointerStore');
  assert(pointer!.scanId === 'scan_budget_test', 'Pointer scanId should match');

  console.error('[test_budget_guard] PASS: 5MB output converted to small pointer JSON');
} finally {
  cleanTmpDir(tmpDir);
}
