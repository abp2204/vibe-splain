import { join } from 'path';
import { rm, readdir } from 'fs/promises';
import { PointerStore } from '../store/PointerStore.js';
import { BlobStore } from '../store/BlobStore.js';

const DEFAULT_KEEP_SCANS = 3;

export async function gcCommand(projectRoot?: string, opts: { keepScans?: number } = {}): Promise<void> {
  const root = projectRoot ?? process.cwd();
  const keepScans = opts.keepScans ?? DEFAULT_KEEP_SCANS;

  console.error(`[vibe-splain gc] Running GC on ${root} (keeping last ${keepScans} scans)`);

  const pointerStore = PointerStore.open(root);
  const blobStore = new BlobStore(root);

  // 1. Get all scan IDs ordered by createdAt desc
  const allScanIds = pointerStore.listAllScanIds();
  console.error(`[vibe-splain gc] Found ${allScanIds.length} scans`);

  // Keep the N most recent by taking last N from sorted list
  // Scan IDs contain timestamps, sort lexicographically descending
  const sorted = [...allScanIds].sort().reverse();
  const keepIds = sorted.slice(0, keepScans);
  const deleteIds = sorted.slice(keepScans);

  if (deleteIds.length === 0) {
    console.error('[vibe-splain gc] Nothing to collect');
    return;
  }

  // 2. Collect all blob paths still referenced by kept pointers before deletion
  const keptPointers = keepIds.flatMap(id => pointerStore.listPointersByScan(id));
  const referencedBlobs = new Set(keptPointers.map(p => p.blobPath));

  // 3. Delete old scan pointers
  const deleted = await pointerStore.gcScanPointers(keepIds);
  console.error(`[vibe-splain gc] Deleted ${deleted} pointer rows`);

  // 4. Delete unreferenced blobs (reference count = 0)
  const allBlobs = await blobStore.listBlobPaths();
  let blobsDeleted = 0;
  for (const blobPath of allBlobs) {
    if (!referencedBlobs.has(blobPath)) {
      try {
        await rm(blobPath);
        blobsDeleted++;
      } catch {
        // ignore — may have already been deleted
      }
    }
  }
  console.error(`[vibe-splain gc] Deleted ${blobsDeleted} unreferenced blobs`);

  // 5. Clean up tmp dir
  const tmpDir = join(root, '.vibe-splainer', 'tmp');
  try {
    const tmpFiles = await readdir(tmpDir);
    for (const f of tmpFiles) {
      await rm(join(tmpDir, f), { force: true });
    }
    console.error(`[vibe-splain gc] Cleaned ${tmpFiles.length} tmp files`);
  } catch {
    // tmp dir may not exist
  }

  console.error('[vibe-splain gc] Done');
}
