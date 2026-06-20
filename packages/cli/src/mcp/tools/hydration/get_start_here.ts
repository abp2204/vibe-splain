import { hydratePointer, applyBudgetGuard } from '../../BudgetGuard.js';

export const getStartHereTool = {
  name: 'get_start_here',
  description: 'Hydrates the start-here index for a scan manifest pointer. Returns the top 5 highest-gravity files. Pointer must be valid and unexpired.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      manifestPointer: { type: 'string', description: 'Pointer ID for the scan manifest or analysis.index artifact' },
      scanId: { type: 'string', description: 'Current scan ID for budget pointer registration' },
    },
    required: ['projectRoot', 'manifestPointer', 'scanId'],
  },
};

export async function handleGetStartHere(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const manifestPointer = args.manifestPointer as string;
  const scanId = args.scanId as string;

  if (!projectRoot || !manifestPointer || !scanId) {
    throw new Error('projectRoot, manifestPointer, and scanId are required');
  }

  // 1. Verify pointer exists, unexpired, hash matches blob
  const { content, row } = await hydratePointer(projectRoot, manifestPointer);

  const payload = JSON.parse(content.toString('utf8'));

  // 2. If it's a manifest pointer, find the analysis.index pointer
  if (row.artifactName === 'artifact_manifest') {
    const manifest = payload as { artifacts: { name: string; indexes?: { startHere: string }; pointer: string }[] };
    const analysisEntry = manifest.artifacts.find(a => a.name === 'analysis' || a.name === 'analysis.index');
    if (!analysisEntry?.indexes?.startHere) {
      throw new Error('Manifest has no analysis.index entry — rescan to regenerate');
    }
    const { content: indexContent } = await hydratePointer(projectRoot, analysisEntry.indexes.startHere);
    const index = JSON.parse(indexContent.toString('utf8'));
    const result = {
      startHere: (index.startHere as string[]).slice(0, 5),
      schemaVersion: index.schemaVersion,
      scanId: index.scanId,
    };
    return await applyBudgetGuard(projectRoot, scanId, 'get_start_here_result', result);
  }

  // 3. If it's an analysis.index pointer directly
  if (row.artifactName === 'analysis.index') {
    const result = {
      startHere: (payload.startHere as string[]).slice(0, 5),
      schemaVersion: payload.schemaVersion,
      scanId: payload.scanId,
    };
    return await applyBudgetGuard(projectRoot, scanId, 'get_start_here_result', result);
  }

  throw new Error(`Unsupported artifact type for get_start_here: ${row.artifactName}`);
}
