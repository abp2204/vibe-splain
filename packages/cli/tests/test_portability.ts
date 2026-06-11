// Test 5: Portability — Bundle/Import
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { BlobStore, computeHash } from '../src/store/BlobStore.js';
import { PointerStore } from '../src/store/PointerStore.js';
import { bundleCommand } from '../src/commands/bundle.js';
import { importBundleCommand } from '../src/commands/importBundle.js';
import { v4 as uuidv4 } from 'uuid';

const tmpDir = makeTmpDir();
try {
  // 1. Simulate a scan: write some blobs and pointers
  const blobStore = new BlobStore(tmpDir);
  const pointerStore = PointerStore.open(tmpDir);
  const scanId = `scan_portability_test_${Date.now()}`;

  const artifacts = [
    { name: 'analysis', content: JSON.stringify({ files: { 'src/index.ts': { gravity: 80 } } }) },
    { name: 'dossier', content: JSON.stringify({ version: '2.0.0', pillars: [] }) },
    { name: 'artifact_manifest', content: JSON.stringify({ scanId, artifacts: [] }) },
  ];

  for (const artifact of artifacts) {
    const { contentHash, blobPath } = await blobStore.writeAtomic(artifact.content);
    const pointerId = `ptr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    await pointerStore.insertPointer({
      pointerId,
      scanId,
      artifactName: artifact.name,
      contentHash,
      blobPath,
      schemaVersion: '1.0.0',
      createdAt: Date.now(),
      expiresAt: null,
    });
  }

  const initialCount = pointerStore.listPointersByScan(scanId).length;
  assert(initialCount === 3, `Expected 3 pointers before bundle, got ${initialCount}`);

  // 2. Generate bundle.tar.gz
  const bundlePath = join(tmpDir, 'test-bundle.tar.gz');
  await bundleCommand(scanId, { output: bundlePath, projectRoot: tmpDir });

  const { existsSync } = await import('fs');
  assert(existsSync(bundlePath), 'bundle.tar.gz should exist');
  console.error('[test_portability] Bundle created successfully');

  // 3. Clear local .vibe-splainer directory completely
  const vibeSplainerDir = join(tmpDir, '.vibe-splainer');
  await rm(vibeSplainerDir, { recursive: true, force: true });
  assert(!existsSync(vibeSplainerDir), '.vibe-splainer should be deleted');

  // Reset the singleton so a fresh DB is created
  PointerStore.reset();

  // 4. Run import
  const namespace = 'test_import';
  await importBundleCommand(bundlePath, { projectRoot: tmpDir, namespace });

  // 5. Assert PointerStore resolves the imported manifest
  const importedStore = PointerStore.open(tmpDir);
  const importedPointers = importedStore.listPointersByScan(`${namespace}::${scanId}`);
  assert(
    importedPointers.length === 3,
    `Expected 3 imported pointers, got ${importedPointers.length}`
  );

  // Verify hash integrity of each imported pointer
  for (const pointer of importedPointers) {
    const valid = await blobStore.verifyIntegrity(pointer.blobPath, pointer.contentHash);
    assert(valid, `Hash integrity failed for imported pointer ${pointer.pointerId}`);
  }

  console.error('[test_portability] PASS: Bundle/Import — PointerStore resolves imported manifest with valid hashes');
} finally {
  cleanTmpDir(tmpDir);
}
