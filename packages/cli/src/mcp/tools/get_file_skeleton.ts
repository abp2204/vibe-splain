import { readFile } from 'fs/promises';
import { join } from 'path';
import { SessionScope, ScopeViolation } from '../SessionScope.js';
import { BlobStore, hashFile } from '../../store/BlobStore.js';
import { PointerStore } from '../../store/PointerStore.js';
import { applyBudgetGuard } from '../BudgetGuard.js';
import { v4 as uuidv4 } from 'uuid';

export const getFileSkeletonTool = {
  name: 'get_file_skeleton',
  description: 'Returns a content-addressed skeleton view of a source file (function signatures, class names, exported symbols). Enforces active workOrder scope. Results are content-addressed — repeated calls on unchanged files return cached pointers.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      filePath: { type: 'string', description: 'Path relative to projectRoot' },
      scanId: { type: 'string', description: 'Current scan ID for pointer registration' },
    },
    required: ['projectRoot', 'filePath', 'scanId'],
  },
};

export async function handleGetFileSkeleton(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePath = args.filePath as string;
  const scanId = args.scanId as string;

  if (!projectRoot || !filePath || !scanId) {
    throw new Error('projectRoot, filePath, and scanId are required');
  }

  // 1. Scope enforcement
  try {
    SessionScope.enforce(filePath);
  } catch (e) {
    if (e instanceof ScopeViolation) throw e;
    throw e;
  }

  const absolutePath = filePath.startsWith('/') ? filePath : join(projectRoot, filePath);

  // 2. Compute preimage hash of source file
  let currentHash: string;
  try {
    currentHash = await hashFile(absolutePath);
  } catch {
    throw new Error(`FileNotFound: cannot read ${filePath}`);
  }

  // 3. Check cache: same hash + parser version = return existing pointer
  const parserVersion = '1.0.0';
  const cacheKey = `skeleton:${currentHash}:${parserVersion}`;
  const pointerStore = PointerStore.open(projectRoot);

  // Look up by contentHash in existing pointers for this scan
  const existingPointers = pointerStore.listPointersByScan(scanId);
  const cached = existingPointers.find(
    p => p.artifactName === 'file_skeleton' && p.contentHash === cacheKey
  );
  if (cached) {
    return {
      pointerId: cached.pointerId,
      contentHash: currentHash,
      cached: true,
      filePath,
    };
  }

  // 4. Build skeleton
  const source = await readFile(absolutePath, 'utf8');
  const skeleton = extractSkeleton(source, filePath);

  // 5. Record content hash
  const skeletonPayload = {
    filePath,
    sourceHash: currentHash,
    parserVersion,
    skeleton,
  };

  // 6. Budget enforcement
  const blobStore = new BlobStore(projectRoot);
  const serialized = JSON.stringify(skeletonPayload, null, 2);
  const { contentHash: skeletonHash, blobPath } = await blobStore.writeAtomic(serialized);
  const pointerId = `ptr_skel_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

  await pointerStore.insertPointer({
    pointerId,
    scanId,
    artifactName: 'file_skeleton',
    contentHash: cacheKey, // cache key encodes source hash + parser version
    blobPath,
    schemaVersion: '1.0.0',
    createdAt: Date.now(),
    expiresAt: null,
  });

  const result = {
    filePath,
    sourceHash: currentHash,
    pointerId,
    skeleton,
  };

  return await applyBudgetGuard(projectRoot, scanId, 'file_skeleton', result);
}

function extractSkeleton(source: string, filePath: string): string[] {
  const lines = source.split('\n');
  const skeleton: string[] = [];
  const ext = filePath.split('.').pop() ?? '';

  const isTS = ['ts', 'tsx'].includes(ext);
  const isJS = ['js', 'jsx', 'mjs', 'cjs'].includes(ext);

  if (isTS || isJS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Exported declarations, function/class/interface/type/enum signatures
      if (
        /^(export\s+)?(async\s+)?function\b/.test(line) ||
        /^(export\s+)?(abstract\s+)?class\b/.test(line) ||
        /^(export\s+)?interface\b/.test(line) ||
        /^(export\s+)?type\s+\w+/.test(line) ||
        /^(export\s+)?enum\b/.test(line) ||
        /^(export\s+)?const\s+\w+\s*[:=(]/.test(line) ||
        /^(export\s+)?let\s+\w+\s*[:=(]/.test(line) ||
        /^(export\s+)?(default\s+)/.test(line) ||
        /^\s*(public|private|protected|static|readonly|abstract)\s+/.test(line) ||
        /^import\b/.test(line)
      ) {
        skeleton.push(`L${i + 1}: ${lines[i]}`);
      }
    }
  } else {
    // Generic: return first 80 lines as skeleton for unsupported types
    return lines.slice(0, 80).map((l, i) => `L${i + 1}: ${l}`);
  }

  return skeleton;
}
