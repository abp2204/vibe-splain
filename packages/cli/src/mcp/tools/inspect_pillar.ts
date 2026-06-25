import { readDossier } from '@vibesplain/brain';

export const inspectPillarTool = {
  name: 'inspect_pillar',
  description: 'Returns all Decision Cards for a specific pillar including full evidence snippets. Use when you need deep detail on a specific area of the codebase.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root',
      },
      pillarName: {
        type: 'string',
        description: 'Name of the pillar to inspect',
      },
    },
    required: ['projectRoot', 'pillarName'],
  },
};

export async function handleInspectPillar(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const pillarName = args.pillarName as string;
  if (!projectRoot || !pillarName) throw new Error('projectRoot and pillarName are required');

  const dossier = await readDossier(projectRoot);
  if (!dossier) {
    return { error: 'No dossier found. Run scan_project first.' };
  }

  const pillar = dossier.pillars.find(p => p.name === pillarName);
  if (!pillar) {
    return {
      error: `Pillar "${pillarName}" not found. Available pillars: ${dossier.pillars.map(p => p.name).join(', ')}`,
    };
  }

  return pillar;
}
