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
  getFileContextTool,
  writeDecisionCardTool,
  getStrategicOverviewTool,
  inspectPillarTool,
  getWildDiscoveriesTool,
  markStaleTool,
];

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  scan_project: handleScanProject,
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
    { name: 'vibe-splain', version: '1.0.0' },
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
            text: 'Use the vibe-splain MCP tools to build a full architectural dossier for this project. Call scan_project first. Then for each high-gravity file, call get_file_context to read the source, synthesize a 3-5 sentence narrative explaining WHY the code exists, and call write_decision_card to persist it. Include Mermaid diagrams where they help explain data flow. When you\'re done, share the exact file:// UI link returned by the tool so I can view the dossier in my browser. Do NOT invent a localhost URL.',
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
