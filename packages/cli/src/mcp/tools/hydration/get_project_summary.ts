import { hydratePointer, applyBudgetGuard } from '../../BudgetGuard.js';

export const getProjectSummaryTool = {
  name: 'get_project_summary',
  description: 'Returns high-level project metrics from a scan manifest pointer: file counts, pillar summary, stack. Token-safe. Pointer must be valid and unexpired.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      manifestPointer: { type: 'string', description: 'Pointer ID for the scan manifest' },
      scanId: { type: 'string', description: 'Current scan ID for budget pointer registration' },
    },
    required: ['projectRoot', 'manifestPointer', 'scanId'],
  },
};

export async function handleGetProjectSummary(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const manifestPointer = args.manifestPointer as string;
  const scanId = args.scanId as string;

  if (!projectRoot || !manifestPointer || !scanId) {
    throw new Error('projectRoot, manifestPointer, and scanId are required');
  }

  const { content, row } = await hydratePointer(projectRoot, manifestPointer);
  const payload = JSON.parse(content.toString('utf8'));

  if (row.artifactName === 'artifact_manifest') {
    const manifest = payload as {
      scanId: string;
      generatedAt: string;
      artifacts: { name: string; indexes?: { startHere: string }; sizeBytes: number }[];
    };
    const analysisEntry = manifest.artifacts.find(a => a.name === 'analysis' && a.indexes?.startHere);
    let indexData: Record<string, unknown> = {};
    if (analysisEntry?.indexes?.startHere) {
      const { content: ic } = await hydratePointer(projectRoot, analysisEntry.indexes.startHere);
      indexData = JSON.parse(ic.toString('utf8'));
    }

    const result = {
      scanId: manifest.scanId,
      generatedAt: manifest.generatedAt,
      artifactCount: manifest.artifacts.length,
      totalArtifactBytes: manifest.artifacts.reduce((s, a) => s + (a.sizeBytes ?? 0), 0),
      startHere: indexData.startHere,
      topHeat: indexData.topHeat,
      pillarSummary: indexData.pillarSummary,
      totalFiles: indexData.totalFiles,
      realSourceFiles: indexData.realSourceFiles,
    };
    return await applyBudgetGuard(projectRoot, scanId, 'get_project_summary_result', result);
  }

  if (row.artifactName === 'analysis.index') {
    const result = {
      scanId: payload.scanId,
      startHere: payload.startHere,
      topHeat: payload.topHeat,
      pillarSummary: payload.pillarSummary,
      totalFiles: payload.totalFiles,
      realSourceFiles: payload.realSourceFiles,
    };
    return await applyBudgetGuard(projectRoot, scanId, 'get_project_summary_result', result);
  }

  throw new Error(`Unsupported artifact type for get_project_summary: ${row.artifactName}`);
}
