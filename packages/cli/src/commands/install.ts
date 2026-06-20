import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

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

// Claude Code PreToolUse hook: deterministically gate edits to high-blast-radius
// files. Hooks are a Claude Code CLI feature (settings.json) — not Desktop/Cursor.
const HOOK_MATCHER = 'Edit|Write|MultiEdit';
const DEFAULT_HOOK_COMMAND = 'npx -y vibe-splain hook pretooluse';

/**
 * Idempotently register the vibe-splain PreToolUse hook in a Claude Code settings object.
 * Pure: takes a config, returns the same object mutated. Safe to run repeatedly.
 */
export function addPreToolUseHook(config: Record<string, any>, hookPath?: string): Record<string, any> {
  if (!config.hooks) config.hooks = {};
  if (!Array.isArray(config.hooks.PreToolUse)) config.hooks.PreToolUse = [];

  const hookCommand = hookPath ? `node "${hookPath}"` : DEFAULT_HOOK_COMMAND;

  const already = config.hooks.PreToolUse.some((entry: any) =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h: any) => typeof h?.command === 'string' && (h.command.includes('vibe-splain hook pretooluse') || h.command.includes('hook.js')))
  );
  if (already) {
    // Update existing hook command to the resolved hook.js path
    config.hooks.PreToolUse = config.hooks.PreToolUse.map((entry: any) => {
      if (Array.isArray(entry?.hooks)) {
        return {
          ...entry,
          hooks: entry.hooks.map((h: any) => {
            if (typeof h?.command === 'string' && (h.command.includes('vibe-splain hook pretooluse') || h.command.includes('hook.js'))) {
              return { ...h, command: hookCommand };
            }
            return h;
          })
        };
      }
      return entry;
    });
    return config;
  }

  config.hooks.PreToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: hookCommand }],
  });
  return config;
}

export async function installCommand(): Promise<void> {
  console.error('\n🔧 vibe-splain Installer\n');
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

      // Patch config (idempotent: only write when something actually changes,
      // so existing users still pick up newly-added pieces like the hook).
      const before = JSON.stringify(config);

      if (!config.mcpServers) config.mcpServers = {};
      if (!config.mcpServers['vibe-splain']) config.mcpServers['vibe-splain'] = MCP_ENTRY;

      // The PreToolUse gate is a Claude Code CLI feature (settings.json hooks).
      // Only register it there; Desktop/Gemini/Cursor don't run these hooks.
      if (agent.name === 'Claude Code CLI') {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const hookPath = join(__dirname, '..', 'hook.js');
        addPreToolUseHook(config, hookPath);
      }

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
        'vibe-splain': MCP_ENTRY
      }
    }, null, 2));
    process.exit(1);
  } else {
    console.error(`\n✅ Patched ${patchedCount} agent config(s). Restart your coding agent to activate.\n`);
  }
}
