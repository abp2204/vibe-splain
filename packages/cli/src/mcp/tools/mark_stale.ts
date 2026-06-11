import { readDossier, writeDossier } from '@vibe-splain/brain';

export const markStaleTool = {
  name: 'mark_stale',
  description: 'Manually marks Decision Cards as stale when you detect a file has changed. The file watcher does this automatically, but call this if you modify a file yourself during a session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root',
      },
      filePaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of relative file paths to mark as stale',
      },
    },
    required: ['projectRoot', 'filePaths'],
  },
};

export async function handleMarkStale(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePaths = args.filePaths as string[];
  if (!projectRoot || !filePaths) throw new Error('projectRoot and filePaths are required');

  const dossier = await readDossier(projectRoot);
  if (!dossier) {
    return { error: 'No dossier found. Run scan_project first.' };
  }

  let staleCount = 0;
  for (const filePath of filePaths) {
    const matches = (card: { primaryFile?: string; evidence: { file: string }[] }) =>
      card.primaryFile === filePath ||
      filePath.endsWith(card.primaryFile || '\0') ||
      card.evidence.some(e => e.file === filePath || filePath.endsWith(e.file));
    for (const pillar of dossier.pillars) {
      for (const card of pillar.decisions) {
        if (matches(card)) { card.status = 'stale'; staleCount++; }
      }
    }
    for (const card of dossier.wildDiscoveries) {
      if (matches(card)) card.status = 'stale';
    }
    if (!dossier.stalePaths.includes(filePath)) {
      dossier.stalePaths.push(filePath);
    }
  }

  await writeDossier(projectRoot, dossier);

  return {
    success: true,
    staleCardsMarked: staleCount,
    totalStalePaths: dossier.stalePaths.length,
  };
}
