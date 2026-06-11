import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { SessionScope, ScopeViolation } from '../SessionScope.js';
import { hashFile, computeHash, BlobStore } from '../../store/BlobStore.js';
import { PointerStore } from '../../store/PointerStore.js';
import { applyBudgetGuard } from '../BudgetGuard.js';
import { v4 as uuidv4 } from 'uuid';

export class StalePatchError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expectedHash: string,
    public readonly actualHash: string,
  ) {
    super(
      `StalePatchError: ${filePath} hash mismatch — expected ${expectedHash}, got ${actualHash}. ` +
      'File was modified since the expectedPrePatchHash was computed. Re-read the file and regenerate the patch.'
    );
    this.name = 'StalePatchError';
  }
}

export const applyPatchTool = {
  name: 'apply_patch',
  description: 'Applies a text patch to a file within the active workOrder scope. Requires expectedPrePatchHash to prevent stale-patch corruption. Records pre- and post-patch hashes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      filePath: { type: 'string', description: 'Path relative to projectRoot' },
      newContent: { type: 'string', description: 'Full new content of the file after the patch' },
      expectedPrePatchHash: {
        type: 'string',
        description: 'sha256:<hex> hash of the file BEFORE patching. Obtain via hashFile or the sourceHash from get_file_skeleton.',
      },
      scanId: { type: 'string', description: 'Current scan ID for pointer registration' },
    },
    required: ['projectRoot', 'filePath', 'newContent', 'expectedPrePatchHash', 'scanId'],
  },
};

export async function handleApplyPatch(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePath = args.filePath as string;
  const newContent = args.newContent as string;
  const expectedPrePatchHash = args.expectedPrePatchHash as string;
  const scanId = args.scanId as string;

  if (!projectRoot || !filePath || !newContent || !expectedPrePatchHash || !scanId) {
    throw new Error('projectRoot, filePath, newContent, expectedPrePatchHash, and scanId are all required');
  }

  // 1. Scope enforcement
  try {
    SessionScope.enforce(filePath);
  } catch (e) {
    if (e instanceof ScopeViolation) throw e;
    throw e;
  }

  const absolutePath = filePath.startsWith('/') ? filePath : join(projectRoot, filePath);

  // 2. Preimage hash check
  let actualPreHash: string;
  try {
    actualPreHash = await hashFile(absolutePath);
  } catch {
    // File doesn't exist yet — for new files, expectedPrePatchHash must be 'sha256:new'
    actualPreHash = 'sha256:new';
  }

  if (actualPreHash !== expectedPrePatchHash) {
    throw new StalePatchError(filePath, expectedPrePatchHash, actualPreHash);
  }

  // 3. Atomic write
  const dir = dirname(absolutePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = absolutePath + `.tmp_${Date.now()}`;
  await writeFile(tmpPath, newContent, 'utf8');
  await rename(tmpPath, absolutePath);

  // 4. Compute post-patch hash
  const postPatchHash = await hashFile(absolutePath);

  // 5. Record both hashes in blob store
  const blobStore = new BlobStore(projectRoot);
  const pointerStore = PointerStore.open(projectRoot);

  const { blobPath } = await blobStore.writeAtomic(newContent);
  const pointerId = `ptr_patch_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

  await pointerStore.insertPointer({
    pointerId,
    scanId,
    artifactName: 'patch_record',
    contentHash: postPatchHash,
    blobPath,
    schemaVersion: '1.0.0',
    createdAt: Date.now(),
    expiresAt: null,
  });

  const result = {
    ok: true,
    filePath,
    prePatchHash: actualPreHash,
    postPatchHash,
    pointerId,
    message: `Patch applied to ${filePath}`,
  };

  return await applyBudgetGuard(projectRoot, scanId, 'patch_record', result);
}
