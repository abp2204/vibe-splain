import { BlobStore } from '../store/BlobStore.js';
import { PointerStore } from '../store/PointerStore.js';
import { v4 as uuidv4 } from 'uuid';

/** ~2000 tokens ≈ 8000 chars */
const BUDGET_CHARS = 8000;

export interface BudgetExceededResult {
  pointerId: string;
  contentHash: string;
  sizeBytes: number;
  summary: string;
  hydrators: string[];
}

export async function applyBudgetGuard(
  projectRoot: string,
  scanId: string,
  artifactName: string,
  output: unknown,
): Promise<unknown> {
  const serialized = JSON.stringify(output, null, 2);
  if (serialized.length <= BUDGET_CHARS) return output;

  const blobStore = new BlobStore(projectRoot);
  const pointerStore = PointerStore.open(projectRoot);

  const { contentHash, blobPath } = await blobStore.writeAtomic(serialized);
  const pointerId = `ptr_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  await pointerStore.insertPointer({
    pointerId,
    scanId,
    artifactName,
    contentHash,
    blobPath,
    schemaVersion: '1.0.0',
    createdAt: Date.now(),
    expiresAt: null,
  });

  const result: BudgetExceededResult = {
    pointerId,
    contentHash,
    sizeBytes: serialized.length,
    summary: `Output exceeded context budget (${serialized.length} chars). Written to artifact blob.`,
    hydrators: ['get_evidence_slice', 'get_start_here', 'get_project_summary'],
  };
  return result;
}

/** Verify a pointer exists, is unexpired, and its blob hash matches */
export async function hydratePointer(
  projectRoot: string,
  pointerId: string,
): Promise<{ content: Buffer; row: import('../store/PointerStore.js').PointerRow }> {
  const pointerStore = PointerStore.open(projectRoot);
  const row = pointerStore.getPointer(pointerId);

  if (!row) {
    throw new Error(`ArtifactNotFound: pointer ${pointerId} does not exist`);
  }

  if (row.expiresAt !== null && row.expiresAt < Date.now()) {
    throw new Error(`ArtifactCollectedError: pointer ${pointerId} has expired`);
  }

  const SUPPORTED_VERSIONS = ['1.0.0', '2.0.0'];
  if (!SUPPORTED_VERSIONS.includes(row.schemaVersion)) {
    throw new Error(`UnsupportedSchema: pointer ${pointerId} has schema version ${row.schemaVersion}`);
  }

  const blobStore = new BlobStore(projectRoot);
  const content = await blobStore.readBlob(row.blobPath);

  const valid = await blobStore.verifyIntegrity(row.blobPath, row.contentHash);
  if (!valid) {
    throw new Error(`IntegrityError: blob for pointer ${pointerId} failed hash verification`);
  }

  return { content, row };
}
