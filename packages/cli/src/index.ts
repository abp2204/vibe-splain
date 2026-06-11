#!/usr/bin/env node
import { Command } from 'commander';
import { installCommand } from './commands/install.js';
import { serveCommand } from './commands/serve.js';
import { exportCommand } from './commands/export.js';
import { gcCommand } from './commands/gc.js';
import { bundleCommand } from './commands/bundle.js';
import { importBundleCommand } from './commands/importBundle.js';

const program = new Command();

program
  .name('vibe-splain')
  .description('Architectural dossier engine for vibe-coded projects')
  .version('3.2.0');

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

program
  .command('export [projectRoot]')
  .description('Manually trigger bundle generation')
  .option('--format <format>', 'Export format (html, markdown, etc.)')
  .option('--budget <budget>', 'Token budget for markdown')
  .option('--scope <scope>', 'Scope for export')
  .action(exportCommand);

program
  .command('gc [projectRoot]')
  .description('Garbage-collect old scan artifacts, keeping the last N scans')
  .option('--keep-scans <n>', 'Number of scans to keep (default: 3)', '3')
  .action((projectRoot, options) => {
    gcCommand(projectRoot, { keepScans: parseInt(options.keepScans, 10) }).catch(err => {
      console.error('[vibe-splain gc] Error:', err.message);
      process.exit(1);
    });
  });

program
  .command('bundle <scanId>')
  .description('Bundle a scan into a portable vibe-bundle.tar.gz')
  .option('--output <path>', 'Output tarball path')
  .option('--project-root <path>', 'Project root (default: cwd)')
  .action((scanId, options) => {
    bundleCommand(scanId, { output: options.output, projectRoot: options.projectRoot }).catch(err => {
      console.error('[vibe-splain bundle] Error:', err.message);
      process.exit(1);
    });
  });

program
  .command('import <tarball>')
  .description('Import a vibe-bundle.tar.gz into the local pointer store')
  .option('--namespace <ns>', 'Bundle namespace alias (default: imported_<timestamp>)')
  .option('--project-root <path>', 'Project root (default: cwd)')
  .action((tarball, options) => {
    importBundleCommand(tarball, { namespace: options.namespace, projectRoot: options.projectRoot }).catch(err => {
      console.error('[vibe-splain import] Error:', err.message);
      process.exit(1);
    });
  });

program.parse();
