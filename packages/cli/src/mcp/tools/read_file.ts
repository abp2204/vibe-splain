import { readFile } from 'fs/promises';
import { join } from 'path';
import { SessionScope, ScopeViolation } from '../SessionScope.js';
import { hashFile } from '../../store/BlobStore.js';
import { BlobStore } from '../../store/BlobStore.js';
import { PointerStore } from '../../store/PointerStore.js';
import { applyBudgetGuard } from '../BudgetGuard.js';
import { v4 as uuidv4 } from 'uuid';

export const readFileTool = {
  name: 'read_file',
  description: 'Reads a file within the active workOrder scope. Enforces allowedFiles/allowedGlobs/deniedGlobs. Records content hash. Output is budgeted.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      filePath: { type: 'string', description: 'Path relative to projectRoot' },
      scanId: { type: 'string', description: 'Current scan ID for pointer registration' },
      startLine: { type: 'number', description: 'Optional: 1-based start line to return a slice' },
      endLine: { type: 'number', description: 'Optional: 1-based end line (inclusive). Capped at startLine+500.' },
    },
    required: ['projectRoot', 'filePath', 'scanId'],
  },
};

export async function handleReadFile(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePath = args.filePath as string;
  const scanId = args.scanId as string;
  const startLine = args.startLine !== undefined ? Number(args.startLine) : undefined;
  const endLine = args.endLine !== undefined
    ? Math.min(Number(args.endLine), (startLine ?? 1) + 500)
    : undefined;

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

  // 2. Read file
  let content: string;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch {
    throw new Error(`FileNotFound: cannot read ${filePath}`);
  }

  // 3. Content hash recording
  const contentHash = await hashFile(absolutePath);

  // 4. Apply line slice if requested
  let output = content;
  let sliceInfo: { startLine: number; endLine: number; totalLines: number } | undefined;
  if (startLine !== undefined) {
    const lines = content.split('\n');
    const end = endLine ?? lines.length;
    output = lines.slice(startLine - 1, end).join('\n');
    sliceInfo = { startLine, endLine: end, totalLines: lines.length };
  }

  // 5. Record content hash in pointer store
  const blobStore = new BlobStore(projectRoot);
  const pointerStore = PointerStore.open(projectRoot);
  const { blobPath } = await blobStore.writeAtomic(content);
  const pointerId = `ptr_file_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

  await pointerStore.insertPointer({
    pointerId,
    scanId,
    artifactName: 'file_read',
    contentHash,
    blobPath,
    schemaVersion: '1.0.0',
    createdAt: Date.now(),
    expiresAt: null,
  });

  const result: Record<string, unknown> = {
    filePath,
    contentHash,
    pointerId,
    content: output,
  };
  if (sliceInfo) result.slice = sliceInfo;

  // 6. Budget enforcement
  return await applyBudgetGuard(projectRoot, scanId, 'file_read', result);
}
