import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface AgentConfig {
  name: string;
  path: string;
  format: 'claude' | 'gemini' | 'cursor';
}

function expandPath(p: string): string {
  if (p.startsWith('~')) {
    return join(homedir(), p.slice(1));
  }
  if (p.startsWith('%APPDATA%')) {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, p.slice('%APPDATA%'.length));
  }
  return p;
}

const AGENT_CONFIGS: AgentConfig[] = [
  { name: 'Claude Code CLI', path: '~/.claude/settings.json', format: 'claude' },
  { name: 'Claude Desktop', path: '~/.claude/claude_desktop_config.json', format: 'claude' },
  { name: 'Claude Desktop (Windows)', path: '%APPDATA%/Claude/claude_desktop_config.json', format: 'claude' },
  { name: 'Gemini CLI', path: '~/.gemini/settings.json', format: 'gemini' },
  { name: 'Cursor', path: '~/.cursor/mcp.json', format: 'cursor' },
  { name: 'Windsurf', path: '~/.codeium/windsurf/mcp_config.json', format: 'cursor' },
];

const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'vibe-splain', 'serve'],
};

export async function installCommand(): Promise<void> {
  console.error('\n🔧 vibesplain Installer\n');
  let patchedCount = 0;

  for (const agent of AGENT_CONFIGS) {
    const resolvedPath = expandPath(agent.path);

    if (!existsSync(resolvedPath)) {
      continue;
    }

    console.error(`  Found ${agent.name} config at ${resolvedPath}`);

    try {
      const raw = await readFile(resolvedPath, 'utf8');
      let config: Record<string, any>;
      try {
        config = JSON.parse(raw);
      } catch {
        console.error(`    ⚠ Could not parse JSON, skipping`);
        continue;
      }

      const before = JSON.stringify(config);

      if (!config.mcpServers) config.mcpServers = {};
      if (!config.mcpServers['vibesplain']) config.mcpServers['vibesplain'] = MCP_ENTRY;

      if (JSON.stringify(config) === before) {
        console.error(`    ✓ Already configured, skipping`);
        patchedCount++;
        continue;
      }

      await writeFile(resolvedPath, JSON.stringify(config, null, 2), 'utf8');
      console.error(`    ✅ Patched successfully`);
      patchedCount++;
    } catch (err) {
      console.error(`    ❌ Error patching: ${err}`);
    }
  }

  if (patchedCount === 0) {
    console.error(`\n⚠️  No supported coding agent config found.`);
    console.error(`Add this manually to your agent's MCP config:\n`);
    console.error(JSON.stringify({
      mcpServers: {
        'vibesplain': MCP_ENTRY
      }
    }, null, 2));
    process.exit(1);
  } else {
    console.error(`\n✅ Patched ${patchedCount} agent config(s). Restart your coding agent to activate.\n`);
  }
}
