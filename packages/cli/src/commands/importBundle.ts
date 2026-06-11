import { join } from 'path';
import { readFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import * as tar from 'tar';
import { createHash } from 'crypto';
import { BlobStore } from '../store/BlobStore.js';
import { PointerStore } from '../store/PointerStore.js';

export async function importBundleCommand(tarballPath: string, opts: { projectRoot?: string; namespace?: string } = {}): Promise<void> {
  const root = opts.projectRoot ?? process.cwd();
  const namespace = opts.namespace ?? `imported_${Date.now()}`;

  console.error(`[vibe-splain import] Importing ${tarballPath} into ${root} (namespace: ${namespace})`);

  if (!existsSync(tarballPath)) {
    throw new Error(`Tarball not found: ${tarballPath}`);
  }

  // Extract to a temp directory
  const extractDir = join(root, '.vibe-splainer', 'tmp', `import-${namespace}`);
  await mkdir(extractDir, { recursive: true });

  try {
    await tar.extract({
      file: tarballPath,
      cwd: extractDir,
    });

    // Read bundle manifest
    const manifestPath = join(extractDir, 'bundle-manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error('Invalid bundle: missing bundle-manifest.json');
    }

    const manifestRaw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as {
      schemaVersion: string;
      scanId: string;
      exportedAt: string;
      projectRoot: string;
      pointers: {
        pointerId: string;
        scanId: string;
        artifactName: string;
        contentHash: string;
        blobFile: string;
        schemaVersion: string;
        createdAt: number;
        expiresAt: number | null;
      }[];
    };

    if (manifest.schemaVersion !== '1.0.0') {
      throw new Error(`Unsupported bundle schema version: ${manifest.schemaVersion}`);
    }

    const blobStore = new BlobStore(root);
    const pointerStore = PointerStore.open(root);
    await blobStore.ensureDirs();

    let imported = 0;
    let hashErrors = 0;

    for (const entry of manifest.pointers) {
      const blobSrcPath = join(extractDir, entry.blobFile);

      if (!existsSync(blobSrcPath)) {
        console.error(`[vibe-splain import] Missing blob for pointer ${entry.pointerId}: ${entry.blobFile}`);
        hashErrors++;
        continue;
      }

      // Verify hash before importing
      const content = await readFile(blobSrcPath);
      const actualHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      if (actualHash !== entry.contentHash) {
        console.error(`[vibe-splain import] Hash mismatch for ${entry.pointerId}: expected ${entry.contentHash}, got ${actualHash}`);
        hashErrors++;
        continue;
      }

      // Write blob to local store (atomic)
      const { blobPath } = await blobStore.writeAtomic(content);

      // Insert pointer under bundle namespace alias
      const namespacedPointerId = `${namespace}::${entry.pointerId}`;
      const namespacedScanId = `${namespace}::${entry.scanId}`;

      await pointerStore.insertPointer({
        pointerId: namespacedPointerId,
        scanId: namespacedScanId,
        artifactName: entry.artifactName,
        contentHash: entry.contentHash,
        blobPath,
        schemaVersion: entry.schemaVersion,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
      });

      imported++;
    }

    if (hashErrors > 0) {
      console.error(`[vibe-splain import] Warning: ${hashErrors} blobs failed hash verification and were skipped`);
    }

    console.error(`[vibe-splain import] Imported ${imported}/${manifest.pointers.length} pointers under namespace "${namespace}"`);
    console.error(`[vibe-splain import] Original scanId: ${manifest.scanId} → namespaced as: ${namespace}::${manifest.scanId}`);
  } finally {
    await rm(extractDir, { recursive: true, force: true });
  }
}
