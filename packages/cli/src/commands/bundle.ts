import { join } from 'path';
import { readFile, writeFile, mkdir, copyFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import * as tar from 'tar';
import { PointerStore } from '../store/PointerStore.js';
import { BlobStore } from '../store/BlobStore.js';

export async function bundleCommand(scanId: string, opts: { output?: string; projectRoot?: string } = {}): Promise<void> {
  const root = opts.projectRoot ?? process.cwd();
  const outputPath = opts.output ?? join(root, `vibe-bundle-${scanId}.tar.gz`);

  console.error(`[vibe-splain bundle] Bundling scan ${scanId} from ${root}`);

  const pointerStore = PointerStore.open(root);
  const blobStore = new BlobStore(root);

  const pointers = pointerStore.listPointersByScan(scanId);
  if (pointers.length === 0) {
    throw new Error(`No pointers found for scanId "${scanId}"`);
  }

  // Stage bundle into a temp directory with predictable layout
  const stagingDir = join(root, '.vibe-splainer', 'tmp', `bundle-stage-${scanId}`);
  const blobsStageDir = join(stagingDir, 'blobs');
  await mkdir(blobsStageDir, { recursive: true });

  try {
    // Build manifest for the bundle
    const bundleManifest = {
      schemaVersion: '1.0.0',
      scanId,
      exportedAt: new Date().toISOString(),
      projectRoot: root,
      pointers: pointers.map(p => ({
        pointerId: p.pointerId,
        scanId: p.scanId,
        artifactName: p.artifactName,
        contentHash: p.contentHash,
        blobFile: `blobs/${p.contentHash.replace('sha256:', 'sha256_')}`,
        schemaVersion: p.schemaVersion,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      })),
    };

    await writeFile(join(stagingDir, 'bundle-manifest.json'), JSON.stringify(bundleManifest, null, 2), 'utf8');

    // Copy blobs (deduplicated by contentHash)
    const seen = new Set<string>();
    for (const p of pointers) {
      const hex = p.contentHash.replace('sha256:', '');
      if (seen.has(hex)) continue;
      seen.add(hex);

      const srcPath = p.blobPath;
      if (!existsSync(srcPath)) {
        console.error(`[vibe-splain bundle] Warning: blob missing for ${p.pointerId}: ${srcPath}`);
        continue;
      }
      await copyFile(srcPath, join(blobsStageDir, `sha256_${hex}`));
    }

    // Create tarball from staging directory
    await tar.create(
      {
        gzip: true,
        file: outputPath,
        cwd: stagingDir,
        portable: true,
      },
      ['.'],
    );

    console.error(`[vibe-splain bundle] Bundle written: ${outputPath}`);
    console.error(`[vibe-splain bundle] ${pointers.length} pointers, ${seen.size} blobs`);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}
