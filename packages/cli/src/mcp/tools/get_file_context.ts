import { readFile } from 'fs/promises';
import { join, relative, isAbsolute } from 'path';
import { getFileAnalysis, readAnalysis } from '@vibe-splain/brain';

export const getFileContextTool = {
  name: 'get_file_context',
  description: 'Returns PRE-EXTRACTED evidence for a file so you do not have to read the whole thing and paraphrase its header comment. Returns: gravity/heat scores + signals, importedBy (named fan-in — use this for blastRadius), hotSpans (the gnarliest function bodies, comment-stripped, each with a reason), smellSpans (located tech debt with ±3 lines of context), and signature (the exported API surface). Base your evidence on hotSpans/smellSpans — NEVER on header comments. Pass { full: true } only if you truly need the raw source.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute path to the project root' },
      filePath: { type: 'string', description: 'Relative or absolute path to the file' },
      full: { type: 'boolean', description: 'Set true to also return the raw source. Default false.' },
    },
    required: ['projectRoot', 'filePath'],
  },
};

export async function handleGetFileContext(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePath = args.filePath as string;
  const full = args.full === true;
  if (!projectRoot || !filePath) throw new Error('projectRoot and filePath are required');

  const fullPath = isAbsolute(filePath) ? filePath : join(projectRoot, filePath);
  const relPath = relative(projectRoot, fullPath);

  const evidence = await getFileAnalysis(fullPath);
  if (!evidence) {
    throw new Error(`Could not analyze ${relPath} (unsupported language or parse failure).`);
  }

  const store = await readAnalysis(projectRoot);
  const persisted = store?.files[relPath];

  const result: Record<string, unknown> = {
    filePath: relPath,
    language: evidence.language,
    gravity: persisted ? Math.round(persisted.gravity) : null,
    heat: persisted ? Math.round(persisted.heat) : null,
    isRealSource: persisted?.isRealSource ?? null,
    demoteReason: persisted?.demoteReason ?? null,
    gravitySignals: persisted?.gravitySignals ?? null,
    heatSignals: evidence.heatSignals,
    importedBy: persisted?.importedBy ?? [],
    imports: persisted?.imports ?? [],
    pillarHint: persisted?.pillarHint ?? null,
    signature: evidence.signature,
    hotSpans: evidence.hotSpans,
    smellSpans: evidence.smellSpans,
  };

  if (full) {
    result.source = await readFile(fullPath, 'utf8');
  }

  return result;
}
