import { readDossier, writeDossier } from '@vibe-splain/brain';

export const setProjectBriefTool = {
  name: 'set_project_brief',
  description: 'Persists your 3-5 sentence project brief into the dossier (and regenerates the UI). Call this AFTER get_project_map and BEFORE writing any decision card. The brief must say: what this project IS, the real stack, and — critically — which files are the actual application vs. mockups/generated/vendored noise.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute path to the project root' },
      brief: { type: 'string', description: '3-5 sentence project brief. What is this, the real stack, app vs. noise.' },
    },
    required: ['projectRoot', 'brief'],
  },
};

export async function handleSetProjectBrief(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const brief = args.brief as string;
  if (!projectRoot || !brief) throw new Error('projectRoot and brief are required');

  const dossier = await readDossier(projectRoot);
  if (!dossier || !dossier.map) {
    return { error: 'No project map found. Run scan_project first.' };
  }

  dossier.map.brief = brief;
  await writeDossier(projectRoot, dossier);

  return { success: true, brief };
}
