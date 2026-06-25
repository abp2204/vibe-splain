import { readDossier } from '@vibesplain/brain';

export const getWildDiscoveriesTool = {
  name: 'get_wild_discoveries',
  description: 'Returns Decision Cards that are both high-heat (heat ≥ 60) AND/OR high-severity (severity ≥ 4) — the files that are load-bearing AND smelly. These are the highest-leverage things to understand and fix first.',
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
