import { readDossier } from '@vibe-splain/brain';

export const getWildDiscoveriesTool = {
  name: 'get_wild_discoveries',
  description: 'Returns files with extremely high cognitive complexity (weight ≥ 25) that don\'t fit standard patterns. These are the most surprising and important parts of the codebase to understand.',
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

export async function handleGetWildDiscoveries(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  if (!projectRoot) throw new Error('projectRoot is required');

  const dossier = await readDossier(projectRoot);
  if (!dossier) {
    return { error: 'No dossier found. Run scan_project first.' };
  }

  return {
    wildDiscoveries: dossier.wildDiscoveries,
    count: dossier.wildDiscoveries.length,
  };
}
