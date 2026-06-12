import { writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { handleScanProject } from '../src/mcp/tools/scan_project.js';
import { initParser } from '@vibe-splain/brain';

async function runTest() {
  const tmpDir = makeTmpDir();
  try {
    console.error(`[test_validation_report] Using tmpDir: ${tmpDir}`);
    await initParser();

    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir, { recursive: true });
    
    // Create a file that should trigger high severity but has no hotSpans
    // Stripe.customers.create is recognized as a database_write/mutation
    await writeFile(join(srcDir, 'payment.ts'), `
      export async function handlePayment(stripe: any) {
        await stripe.customers.create();
      }
    `, 'utf8');

    // Run scan
    console.error('[test_validation_report] Running scan...');
    const result = await handleScanProject({ projectRoot: tmpDir }) as any;
    
    assert(result.ok === true, 'Scan should be successful');
    
    // Check validation_report.json artifact on disk
    const reportPath = join(tmpDir, '.vibe-splainer', 'validation_report.json');
    const reportRaw = await readFile(reportPath, 'utf8');
    const report = JSON.parse(reportRaw);
    
    console.error('[test_validation_report] Validation report errors type:', typeof report.errors);
    
    assert(typeof report.passed === 'boolean', 'report.passed should be boolean');
    assert(Array.isArray(report.errors), 'report.errors should be an array (CONTRACT ENFORCEMENT)');
    assert(Array.isArray(report.warnings), 'report.warnings should be an array');
    assert(typeof report.summary === 'object', 'report.summary should be an object');
    assert(typeof report.summary.errorCount === 'number', 'report.summary.errorCount should be a number');

    // Check the result returned to MCP
    assert(Array.isArray(result.validation.errors), 'result.validation.errors should be an array');
    
    console.error('[test_validation_report] PASS: validation_report.json has correct structured schema');

  } catch (e) {
    console.error('[test_validation_report] FAIL:', e);
    process.exit(1);
  } finally {
    cleanTmpDir(tmpDir);
  }
}

runTest();
