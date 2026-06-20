import { hydratePointer, applyBudgetGuard } from '../../BudgetGuard.js';
import { SessionScope } from '../../SessionScope.js';

export const getEvidenceSliceTool = {
  name: 'get_evidence_slice',
  description: 'Raw fallback: returns a line-range slice from a blob artifact. Pointer must be valid and unexpired. Output is budgeted.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      pointerId: { type: 'string', description: 'Pointer ID for the target artifact' },
      startLine: { type: 'number', description: 'Inclusive start line (1-based)' },
      endLine: { type: 'number', description: 'Inclusive end line (1-based). Capped at startLine+200.' },
      scanId: { type: 'string', description: 'Current scan ID for budget pointer registration' },
    },
    required: ['projectRoot', 'pointerId', 'startLine', 'endLine', 'scanId'],
  },
};

export async function handleGetEvidenceSlice(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const pointerId = args.pointerId as string;
  const startLine = Number(args.startLine);
  const endLine = Math.min(Number(args.endLine), startLine + 200);
  const scanId = args.scanId as string;

  if (!projectRoot || !pointerId || !scanId) {
    throw new Error('projectRoot, pointerId, startLine, endLine, and scanId are required');
  }

  // 1. Verify pointer, lifetime, hash
  const { content, row } = await hydratePointer(projectRoot, pointerId);
  const rawText = content.toString('utf8');

  // Scope enforcement: if a Worker scope is active, enforce it for file-type artifacts
  const scope = SessionScope.get();
  if (scope && (row.artifactName === 'file_read' || row.artifactName === 'file_skeleton')) {
    try {
      const parsed = JSON.parse(rawText) as { filePath?: string };
      if (parsed.filePath) {
        SessionScope.enforce(parsed.filePath);
      }
    } catch (e) {
      if ((e as Error).name === 'ScopeViolation') throw e;
    }
  }

  const lines = rawText.split('\n');

  const sliced = lines.slice(startLine - 1, endLine);
  const result = {
    pointerId,
    artifactName: row.artifactName,
    startLine,
    endLine,
    totalLines: lines.length,
    slice: sliced,
  };

  // 2. Budget query result
  return await applyBudgetGuard(projectRoot, scanId, 'evidence_slice', result);
}
