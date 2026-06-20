import { startMCPServer } from '../mcp/server.js';

export async function serveCommand(options?: any): Promise<void> {
  console.error('[vibe-splain] Starting MCP server...');
  await startMCPServer(options);
  // Process stays alive — do NOT call process.exit() here
}
