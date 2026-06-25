import { readDossier } from '@vibesplain/brain';

export const getProjectMapTool = {
  name: 'get_project_map',
  description: 'Returns the project map produced by scan_project: the detected stack, entrypoints, the FIXED set of architectural pillars (you may NOT invent others — write_decision_card rejects unknown pillars), the Start-Here files (highest gravity = most depended-upon), and the Wild-Discovery candidates (highest heat = most tech debt). BEFORE writing any card you MUST: read this map, write a 3-5 sentence project brief, and persist it via set_project_brief.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute path to the project root' },
    },
    required: ['projectRoot'],
  },
};

export async function handleGetProjectMap(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  if (!projectRoot) throw new Error('projectRoot is required');

  const dossier = await readDossier(projectRoot);
  if (!dossier || !dossier.map) {
    return { error: 'No project map found. Run scan_project first.' };
  }

  const m = dossier.map;
  return {
    stack: m.stack,
    entrypoints: m.entrypoints,
    fileCount: m.fileCount,
    realSourceCount: m.realSourceCount,
    pillars: m.pillars.map(p => ({
      name: p.name,
      description: p.description,
      memberFiles: p.memberFiles,
    })),
    legalPillarNames: m.pillars.map(p => p.name),
    startHere: m.topGravity,
    wildDiscoveryCandidates: m.topHeat,
    brief: m.brief,
    nextStep: m.brief
      ? 'Brief is set. Work the Start-Here files first via get_file_context, then write_decision_card.'
      : 'Write a 3-5 sentence brief and call set_project_brief BEFORE any card.',
  };
}
