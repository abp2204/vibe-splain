import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { handleScanProject } from '../src/mcp/tools/scan_project.js';
import { initParser, readAnalysis } from '@vibe-splain/brain';

async function runTest() {
  const tmpDir = makeTmpDir();
  try {
    console.error(`[test_no_adapter_safety] Using tmpDir: ${tmpDir}`);
    await initParser();

    const srcDir = join(tmpDir, 'src');
    await mkdir(srcDir, { recursive: true });
    
    await writeFile(join(srcDir, 'index.ts'), `
      import { db } from './db';
      export function doSomething() { db.write('hello'); }
    `, 'utf8');

    await writeFile(join(srcDir, 'db.ts'), `
      export const db = { write: (str: string) => console.log(str) };
    `, 'utf8');

    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: "test-app", dependencies: {} }), 'utf8');

    console.error('[test_no_adapter_safety] Running scan...');
    const result = await handleScanProject({ projectRoot: tmpDir }, { watch: false }) as any;
    assert(result.ok === true, 'Scan should be successful');
    
    const analysis = await readAnalysis(tmpDir);
    
    for (const [rel, file] of Object.entries(analysis!.files)) {
      if (file.adapterDomain) assert(false, `adapterDomain present on ${rel}`);
      if (file.domainTags && file.domainTags.length > 0) assert(false, `domainTags present on ${rel}`);
      if (file.adapterSideEffects && file.adapterSideEffects.length > 0) assert(false, `adapterSideEffects present on ${rel}`);
      if (file.adapterPillarLabel) assert(false, `adapterPillarLabel present on ${rel}`);
      if (file.adapterSeverityContribution) assert(false, `adapterSeverityContribution present on ${rel}`);
      // ADR-034 Gate 3: with no adapter firing, lift is structurally zero and
      // the lifted gravity is identical to the pristine static score.
      assert(file.behavioralLift === 0, `behavioralLift must be 0 with no adapter, got ${file.behavioralLift} on ${rel}`);
      assert(file.gravity === file.staticGravity, `gravity must equal staticGravity with no adapter on ${rel} (${file.gravity} vs ${file.staticGravity})`);
    }

    console.log('[test_no_adapter_safety] PASS: unknown/no-adapter repo pure generic constraints verified.');
  } finally {
    await cleanTmpDir(tmpDir);
  }
}

// The scan runs with watch:false, so no chokidar watcher keeps the event loop
// alive; the process exits naturally once runTest resolves. No success-path
// exit(0) — natural termination proves there is no lingering watcher.
runTest().catch(err => {
  console.error('[test_no_adapter_safety] FAIL:', err);
  process.exit(1);
});
