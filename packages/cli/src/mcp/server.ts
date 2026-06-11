import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initParser } from '@vibe-splain/brain';
import { handleScanProject, scanProjectTool } from './tools/scan_project.js';
import { handleGetProjectMap, getProjectMapTool } from './tools/get_project_map.js';
import { handleSetProjectBrief, setProjectBriefTool } from './tools/set_project_brief.js';
import { handleGetFileContext, getFileContextTool } from './tools/get_file_context.js';
import { handleWriteDecisionCard, writeDecisionCardTool } from './tools/write_decision_card.js';
import { handleGetStrategicOverview, getStrategicOverviewTool } from './tools/get_strategic_overview.js';
import { handleInspectPillar, inspectPillarTool } from './tools/inspect_pillar.js';
import { handleGetWildDiscoveries, getWildDiscoveriesTool } from './tools/get_wild_discoveries.js';
import { handleMarkStale, markStaleTool } from './tools/mark_stale.js';

// ⚠️ CRITICAL: Never use console.log() anywhere in this codebase.
// stdout is owned by the MCP SDK for protocol messages.
// Use console.error() for all diagnostic output.

const ALL_TOOLS = [
  scanProjectTool,
  getProjectMapTool,
  setProjectBriefTool,
  getFileContextTool,
  writeDecisionCardTool,
  getStrategicOverviewTool,
  inspectPillarTool,
  getWildDiscoveriesTool,
  markStaleTool,
];

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  scan_project: handleScanProject,
  get_project_map: handleGetProjectMap,
  set_project_brief: handleSetProjectBrief,
  get_file_context: handleGetFileContext,
  write_decision_card: handleWriteDecisionCard,
  get_strategic_overview: handleGetStrategicOverview,
  inspect_pillar: handleInspectPillar,
  get_wild_discoveries: handleGetWildDiscoveries,
  mark_stale: handleMarkStale,
};

export async function startMCPServer(): Promise<void> {
  // Initialize Tree-Sitter WASM once at startup
  await initParser();
  console.error('[vibe-splain] Tree-Sitter parser initialized');

  const server = new Server(
    { name: 'vibe-splain', version: '2.0.0' },
    { capabilities: { tools: {}, prompts: {} } }
  );

  // Register prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'build_dossier',
        description: 'Build a full architectural dossier using vibe-splain (replaces the need to copy-paste the README prompt)',
      }
    ]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== 'build_dossier') {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    return {
      description: 'Build a full architectural dossier',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are a skeptical staff engineer doing a HOSTILE architecture review of this codebase.
You are NOT writing documentation. You are finding the load-bearing walls, the landmines,
and the clever moves, and you are taking positions on them.

PROCESS — follow in order:
1. Call scan_project, then get_project_map. The map gives you: the detected stack,
   the FIXED set of pillars (you may not invent others), the Start-Here files (highest
   gravity = most depended-upon), and Wild-Discovery candidates (highest heat = most smell).
2. Read the map's stack and entrypoints. Write a 3-5 sentence project brief: what IS this,
   what's the real stack, and — critically — which files are the actual application vs.
   mockups/generated/vendored noise. Pass it via set_project_brief. Do this BEFORE any card.
3. Work the Start-Here files first (highest gravity), then the Wild-Discovery files.
   For each, call get_file_context. It returns hotSpans (the gnarliest functions) and
   smellSpans (located tech debt) — base your evidence on THOSE, never on header comments.
4. Write one decision card per file via write_decision_card.

This is an AUTONOMOUS loop. Every tool response includes a \`nextStep\` and often a
\`remainingFiles\` list — OBEY them. Do NOT stop, summarize, or ask the user "how would
you like to proceed" until every Start-Here and Wild-Discovery file has a card. Writing
the brief is the START of the work, not the end. Keep calling get_file_context +
write_decision_card until remainingFiles is empty.

RULES FOR EVERY CARD — non-negotiable:
- The \`thesis\` is a VERDICT in one sentence. Take a position. If you can't, you don't
  understand the file yet — read more.
- Pick a \`category\`: Bottleneck, Hack, Smart-Move, Risk, Convention, or Dead-Weight.
- \`blastRadius\` must reference the real fan-in (get_file_context.importedBy).
- NEVER paraphrase the file's own comments. If the insight is already in a // block,
  it is not insight — go deeper into the logic.
- Evidence = 5-20 lines of the ACTUAL interesting code (hotSpans/smellSpans). Never the
  whole file, never the doc-header.
- For every Wild-Discovery candidate, name the specific smell and rate its severity.

────────────────────────────────────────────────────────
EXAMPLE — what GOOD vs BAD looks like:

BAD (rejected — this is a book report):
  title: "Panel Component Framework"
  narrative: "This module establishes the structural framework for the panel-based
  interface. It defines the generic Panel shell that standardizes look and feel..."
  → Restates the header comment. No position. No risk. No tradeoff. Worthless.

GOOD (accepted):
  title: "Panel shell carries 14 props and 6 tools in one file"
  thesis: "cipher-panels-a.jsx is a god-file: one 600-line module owns the shared shell
           AND three unrelated generators, so any panel change risks all of them."
  category: "Risk"  severity: 4
  narrative: "Panel was built as a single shell to guarantee visual consistency, but the
              three generators (Palette/Vibe/Pocket) were folded in beside it instead of
              split out. The shell threads 14 props through every tool, so the generators
              are now coupled to the shell's drag/compact state they don't use."
  tradeoff: "Bought consistency and one import site; paid with a module no one can change
             safely and props that leak shell concerns into pure generators."
  blastRadius: "Imported by cipher-shell.jsx (the app root) — a regression here is a
                full-app regression."
  evidence: [ the 14-param Panel signature; the prop-drill into PalettePanel ]
────────────────────────────────────────────────────────

When done, share the exact file:// UI link returned by scan_project. Never invent a URL.`,
          }
        }
      ]
    };
  });

  // Register tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  // Register tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = TOOL_HANDLERS[name];

    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await handler((args || {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[vibe-splain] Tool ${name} error:`, message);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[vibe-splain] MCP server running on stdio');
  // Process stays alive — do NOT call process.exit() here
}
