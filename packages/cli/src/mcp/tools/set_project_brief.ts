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

  // Drive the loop: hand back the exact remaining worklist so the agent does
  // not stop and ask the user. Weak models treat "brief saved" as done otherwise.
  const documented = new Set(
    [...dossier.pillars.flatMap(p => p.decisions), ...dossier.wildDiscoveries]
      .map(c => c.primaryFile).filter(Boolean) as string[]
  );
  const startHere = dossier.map.topGravity.filter(f => !documented.has(f));
  const wild = dossier.map.topHeat.filter(f => !documented.has(f));
  const worklist = [...new Set([...startHere, ...wild])];

  return {
    success: true,
    brief,
    remainingFiles: worklist,
    legalPillarNames: dossier.map.pillars.map(p => p.name),
    nextStep:
      worklist.length === 0
        ? 'All files documented. Share the file:// UI link from scan_project.'
        : `Brief saved. DO NOT STOP and DO NOT ask the user what to do next. Now loop: for EACH of the ${worklist.length} files in remainingFiles, call get_file_context then write_decision_card. Start with "${worklist[0]}". Continue until every file has a card, then share the file:// UI link.`,
  };
}
