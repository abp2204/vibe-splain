// Worker script: writes 100 pointers to a shared DB then exits.
// Called with args: <projectRoot> <workerId>
import { PointerStore } from '../src/store/PointerStore.js';
import { v4 as uuidv4 } from 'uuid';

const projectRoot = process.argv[2];
const workerId = process.argv[3];

if (!projectRoot || !workerId) {
  console.error('Usage: wal_worker.ts <projectRoot> <workerId>');
  process.exit(1);
}

const store = PointerStore.open(projectRoot);
const promises: Promise<void>[] = [];

for (let i = 0; i < 100; i++) {
  promises.push(store.insertPointer({
    pointerId: `ptr_${workerId}_${i}_${uuidv4().replace(/-/g, '').slice(0, 8)}`,
    scanId: `scan_worker_${workerId}`,
    artifactName: `artifact_${i}`,
    contentHash: `sha256:${'a'.repeat(64)}`,
    blobPath: `/tmp/fake_blob_${i}`,
    schemaVersion: '1.0.0',
    createdAt: Date.now(),
    expiresAt: null,
  }));
}

await Promise.all(promises);
console.error(`[worker ${workerId}] Done: 100 pointers written`);
