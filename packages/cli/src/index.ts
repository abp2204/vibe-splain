#!/usr/bin/env node
import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { serveCommand } from './commands/serve.js';

const program = new Command();

program
  .name('vibe-splain')
  .description('Architectural dossier engine for vibe-coded projects')
  .version('1.0.0');

program
  .command('install')
  .description('Patch coding agent MCP config files to register vibe-splain')
  .action(installCommand);

program
  .command('serve')
  .description('Start the MCP server (called by the coding agent, not by you)')
  .action(serveCommand);

program.parse();
