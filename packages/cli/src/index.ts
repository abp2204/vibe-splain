#!/usr/bin/env node
import { resolve } from 'path';
import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { serveCommand } from './commands/serve.js';
import { hookPreToolUseCommand } from './commands/hook.js';

const program = new Command();

program
  .name('vibe-splain')
  .description('Architectural dossier engine for vibe-coded projects')
  .version('3.5.0');

program
  .command('scan')
  .description('Scan a project and write dossier artifacts')
  .option('--root <root>', 'Project root directory to scan', '.')
  .option('--format <format>', 'Export format (html, markdown, etc.)')
  .option('--budget <budget>', 'Token budget for markdown')
  .option('--scope <scope>', 'Scope for export')
  .action(async (options) => {
    try {
      const rootPath = resolve(options.root);
      const { handleScanProject } = await import('./mcp/tools/scan_project.js');
      const result = await handleScanProject({ projectRoot: rootPath }, { watch: false, ...options }) as any;
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      console.error('[scan] Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Patch coding agent MCP config files to register vibe-splain')
  .action(installCommand);

program
  .command('serve')
  .description('Start the MCP server (called by the coding agent, not by you)')
  .option('--format <format>', 'Export format (html, markdown, etc.)')
  .option('--budget <budget>', 'Token budget for markdown')
  .option('--scope <scope>', 'Scope for export')
  .action((options) => serveCommand(options));

const hookCmd = program
  .command('hook')
  .description('Deterministic agent hooks (called by your coding agent, not by you)');

hookCmd
  .command('pretooluse')
  .description('PreToolUse gate: escalate edits to high-blast-radius files')
  .action(() => hookPreToolUseCommand());

program.parse();

