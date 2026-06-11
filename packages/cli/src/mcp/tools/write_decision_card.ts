import { readDossier, writeDossier, validateMermaidNodeCount } from '@vibe-splain/brain';
import type { DecisionCard, Evidence } from '@vibe-splain/brain';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const writeDecisionCardTool = {
  name: 'write_decision_card',
  description: 'Persists a Decision Card you have synthesized to the project\'s dossier. The narrative should be 3–5 sentences explaining WHY this code exists. Evidence must reference specific line ranges from the actual source. Diagrams are optional but use only stateDiagram-v2, flowchart TD, or linear A-->B-->C style, max 7 nodes. Will reject diagrams with more than 7 nodes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root',
      },
      pillar: {
        type: 'string',
        description: 'The pillar this card belongs to (e.g., Auth, Database, etc.)',
      },
      title: {
        type: 'string',
        description: 'Short title for the decision card',
      },
      narrative: {
        type: 'string',
        description: '3-5 sentences explaining WHY this code exists',
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Relative file path' },
            startLine: { type: 'number', description: 'Start line number' },
            endLine: { type: 'number', description: 'End line number' },
            snippet: { type: 'string', description: 'Code snippet from the file' },
          },
          required: ['file', 'startLine', 'endLine', 'snippet'],
        },
        description: 'Array of evidence items referencing specific code',
      },
      diagram: {
        type: 'string',
        description: 'Optional Mermaid diagram (stateDiagram-v2, flowchart TD, or linear style). Max 7 nodes.',
      },
    },
    required: ['projectRoot', 'pillar', 'title', 'narrative', 'evidence'],
  },
};

export async function handleWriteDecisionCard(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const pillar = args.pillar as string;
  const title = args.title as string;
  const narrative = args.narrative as string;
  const evidence = args.evidence as Evidence[];
  const diagram = (args.diagram as string) || null;

  if (!projectRoot || !pillar || !title || !narrative || !evidence) {
    throw new Error('projectRoot, pillar, title, narrative, and evidence are required');
  }

  // Validate Mermaid diagram node count
  if (diagram && !validateMermaidNodeCount(diagram)) {
    throw new Error('Mermaid diagram exceeds maximum of 7 nodes. Simplify the diagram.');
  }

  // Compute hash from evidence files
  let combinedContent = '';
  for (const e of evidence) {
    try {
      const fullPath = join(projectRoot, e.file);
      const content = await readFile(fullPath, 'utf8');
      combinedContent += content;
    } catch {
      // File might not exist, use snippet
      combinedContent += e.snippet;
    }
  }
  const hash = createHash('sha256').update(combinedContent).digest('hex');

  const card: DecisionCard = {
    id: uuidv4(),
    pillar,
    title,
    narrative,
    evidence,
    diagram,
    status: 'fresh',
    lastScannedHash: hash,
  };

  // Read existing dossier or create new one
  let dossier = await readDossier(projectRoot);
  if (!dossier) {
    dossier = {
      version: '1.0.0',
      scannedAt: new Date().toISOString(),
      projectRoot,
      pillars: [],
      wildDiscoveries: [],
      stalePaths: [],
    };
  }

  // Find or create pillar
  let existingPillar = dossier.pillars.find(p => p.name === pillar);
  if (!existingPillar) {
    existingPillar = { name: pillar, cardCount: 0, decisions: [] };
    dossier.pillars.push(existingPillar);
  }

  // Add card to pillar
  existingPillar.decisions.push(card);
  existingPillar.cardCount = existingPillar.decisions.length;

  await writeDossier(projectRoot, dossier);

  console.error(`[vibe-splain] Decision card written: "${title}" in pillar "${pillar}"`);

  return {
    success: true,
    cardId: card.id,
    pillar,
    title,
  };
}
