import { startMCPServer } from '../mcp/server.js';

export async function serveCommand(): Promise<void> {
  console.error('[vibe-splain] Starting MCP server...');
  await startMCPServer();
  // Process stays alive — do NOT call process.exit() here
}
