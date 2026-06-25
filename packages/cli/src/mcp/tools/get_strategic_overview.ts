import { readDossier } from '@vibesplain/brain';

export const getStrategicOverviewTool = {
  name: 'get_strategic_overview',
  description: 'Returns the current state of the dossier without evidence snippets (to save tokens). Use this to see what has already been analyzed and what is stale. Check stalePaths to know which files need re-analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root',
      },
    },
    required: ['projectRoot'],
  },
};

export async function handleGetStrategicOverview(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  if (!projectRoot) throw new Error('projectRoot is required');

  const dossier = await readDossier(projectRoot);
  if (!dossier) {
    return { error: 'No dossier found. Run scan_project first.' };
  }

  return {
    version: dossier.version,
    scannedAt: dossier.scannedAt,
    projectRoot: dossier.projectRoot,
    pillars: dossier.pillars.map(p => ({
      name: p.name,
      cardCount: p.cardCount,
      decisions: p.decisions.map(d => ({
        id: d.id,
        title: d.title,
        status: d.status,
        pillar: d.pillar,
        // Omit evidence snippets to save tokens
        evidenceFileCount: d.evidence.length,
        hasDiagram: !!d.diagram,
      })),
    })),
    wildDiscoveriesCount: dossier.wildDiscoveries.length,
    stalePaths: dossier.stalePaths,
  };
}
