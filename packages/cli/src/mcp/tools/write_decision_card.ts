import { readDossier, writeDossier, validateMermaidNodeCount, readAnalysis } from '@vibe-splain/brain';
import type { DecisionCard, Evidence, CardCategory } from '@vibe-splain/brain';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

const CATEGORIES: CardCategory[] = ['Bottleneck', 'Hack', 'Smart-Move', 'Risk', 'Convention', 'Dead-Weight'];

// Agents frequently emit snippets with literal "\n"/"\t" instead of real
// newlines, which collapses the code into one line in the UI. Restore them.
function normalizeSnippet(s: string): string {
  let out = (s ?? '').replace(/\r\n/g, '\n');
  if (/\\[nt]/.test(out)) {
    out = out.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '  ');
  }
  return out.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

export const writeDecisionCardTool = {
  name: 'write_decision_card',
  description: 'Persists ONE Decision Card about ONE file. This is a hostile architecture review, not documentation. The thesis must be a VERDICT, not a description. The pillar MUST be one of the names from get_project_map (free-form is rejected). One card per file (duplicates rejected). Evidence must come from get_file_context hotSpans/smellSpans — never the header comment, never the whole file.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string' },
      pillar: { type: 'string', description: 'MUST be one of the pillar names from get_project_map. Free-form values are rejected.' },
      primaryFile: { type: 'string', description: 'The single file this card is about (relative path). Used to reject duplicate cards.' },
      title: { type: 'string' },
      thesis: { type: 'string', description: "ONE sharp sentence. A verdict, not a description. Take a position. Bad: 'This file implements a panel system.' Good: 'A 600-line god-component that owns drag, zoom, persistence AND the host bridge — the single highest-risk refactor in the app.'" },
      category: { type: 'string', enum: CATEGORIES },
      severity: { type: 'integer', minimum: 1, maximum: 5 },
      narrative: { type: 'string', description: "3-5 sentences. WHY it exists and WHY it's built this way. Do NOT restate the file's header comments." },
      tradeoff: { type: 'string', description: 'What was given up, or why the obvious approach was rejected. Null only if genuinely none.' },
      blastRadius: { type: 'string', description: 'What breaks if this changes. Ground it in the fan-in (importedBy) from get_file_context.' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Do NOT default to "high". Reserve "high" ONLY for provable execution anti-patterns. Score subjective stylistic choices or abstractions as "low" or "medium".' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            snippet: { type: 'string' },
          },
          required: ['file', 'startLine', 'endLine', 'snippet'],
        },
        description: 'Use hotSpans/smellSpans from get_file_context. NEVER cite header comments or the whole file.',
      },
      diagram: { type: 'string', description: 'Optional. stateDiagram-v2 / flowchart TD / linear. Max 7 nodes.' },
    },
    required: ['projectRoot', 'pillar', 'primaryFile', 'title', 'thesis', 'category', 'severity', 'narrative', 'confidence', 'evidence'],
  },
};

export async function handleWriteDecisionCard(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const pillar = args.pillar as string;
  const primaryFile = args.primaryFile as string;
  const title = args.title as string;
  const thesis = args.thesis as string;
  const category = args.category as CardCategory;
  const severity = args.severity as 1 | 2 | 3 | 4 | 5;
  const narrative = args.narrative as string;
  const tradeoff = (args.tradeoff as string) || null;
  const blastRadius = (args.blastRadius as string) || null;
  const confidence = (args.confidence as 'low' | 'medium' | 'high') || 'medium';
  const rawEvidence = args.evidence as Evidence[];
  const evidence: Evidence[] = (rawEvidence || []).map(e => ({ ...e, snippet: normalizeSnippet(e.snippet) }));
  const diagram = (args.diagram as string) || null;

  if (!projectRoot || !pillar || !primaryFile || !title || !thesis || !category || !narrative || !rawEvidence || rawEvidence.length === 0) {
    throw new Error('projectRoot, pillar, primaryFile, title, thesis, category, narrative, and evidence are required');
  }
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Must be one of: ${CATEGORIES.join(', ')}`);
  }
  if (diagram && !validateMermaidNodeCount(diagram)) {
    throw new Error('Mermaid diagram exceeds maximum of 7 nodes. Simplify the diagram.');
  }

  const dossier = await readDossier(projectRoot);
  if (!dossier || !dossier.map) {
    throw new Error('No project map found. Run scan_project and set_project_brief before writing cards.');
  }

  // Enforce fixed pillar set.
  const legalPillars = dossier.map.pillars.map(p => p.name);
  if (!legalPillars.includes(pillar)) {
    throw new Error(`Pillar "${pillar}" is not a legal pillar. Use one of: ${legalPillars.join(', ')}. Pillars are fixed by the scan — you may not invent new ones.`);
  }

  // Reject duplicate primaryFile — unless the existing card is stale (rewrite path).
  const existing = [...dossier.pillars.flatMap(p => p.decisions), ...dossier.wildDiscoveries]
    .find(c => c.primaryFile === primaryFile);
  if (existing) {
    if (existing.status === 'fresh') {
      throw new Error(`A card already exists for "${primaryFile}". One card per file. To revise it, call mark_stale on this file and rewrite, or pick a different file.`);
    }
    // stale: drop the old card so the rewrite can replace it.
    for (const p of dossier.pillars) p.decisions = p.decisions.filter(c => c.id !== existing.id);
    dossier.wildDiscoveries = dossier.wildDiscoveries.filter(c => c.id !== existing.id);
  }

  // Auto-carry gravity/heat from the scan.
  const store = await readAnalysis(projectRoot);
  const persisted = store?.files[primaryFile];
  const gravity = persisted ? Math.round(persisted.gravity) : undefined;
  const heat = persisted ? Math.round(persisted.heat) : undefined;

  // Hash the primaryFile so the watcher can detect staleness per-file.
  let primaryContent = '';
  try { primaryContent = await readFile(join(projectRoot, primaryFile), 'utf8'); } catch { /* */ }
  const hash = createHash('sha256').update(primaryContent).digest('hex');

  const card: DecisionCard = {
    id: uuidv4(),
    pillar, title, thesis, category, severity, narrative,
    tradeoff, blastRadius, confidence, evidence, diagram,
    gravity, heat, primaryFile,
    status: 'fresh',
    lastScannedHash: hash,
  };

  // A high-heat card (severity >= 4) is also a Wild Discovery.
  const isWild = severity >= 4 || (heat !== undefined && heat >= 60);
  if (isWild) {
    dossier.wildDiscoveries.push(card);
  }

  let bucket = dossier.pillars.find(p => p.name === pillar);
  if (!bucket) {
    bucket = { name: pillar, cardCount: 0, decisions: [] };
    dossier.pillars.push(bucket);
  }
  bucket.decisions.push(card);
  bucket.cardCount = bucket.decisions.length;

  await writeDossier(projectRoot, dossier);

  console.error(`[vibe-splain] Card written: "${title}" [${category} sev${severity}] in "${pillar}"${isWild ? ' (Wild Discovery)' : ''}`);

  // Keep the loop going: compute what is still undocumented.
  const documented = new Set(
    [...dossier.pillars.flatMap(p => p.decisions), ...dossier.wildDiscoveries]
      .map(c => c.primaryFile).filter(Boolean) as string[]
  );
  const remaining = [...new Set([...dossier.map.topGravity, ...dossier.map.topHeat])]
    .filter(f => !documented.has(f));

  return {
    success: true, cardId: card.id, pillar, primaryFile, category, severity,
    wildDiscovery: isWild, gravity, heat,
    remainingFiles: remaining,
    nextStep:
      remaining.length === 0
        ? 'Every Start-Here and Wild-Discovery file now has a card. Share the file:// UI link from scan_project. Done.'
        : `Card saved. DO NOT STOP. ${remaining.length} files left. Next: call get_file_context then write_decision_card for "${remaining[0]}".`,
  };
}
