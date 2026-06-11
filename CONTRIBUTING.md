# Contributing to VIBE-SPLAIN

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/abp2204/vibe-splain.git
cd vibe-splain
npm install
npm run build
```

## Project Structure

This is an npm workspaces monorepo with three packages:

| Package | Path | Purpose |
|---------|------|---------|
| `@vibe-splain/brain` | `packages/brain/` | Tree-Sitter analysis engine |
| `vibe-splain` | `packages/cli/` | MCP server + CLI (published to npm) |
| `@vibe-splain/ui` | `packages/ui/` | React dossier viewer |

Build order matters: **brain → cli → ui → bundle-ui**.

## Important Constraints

Before submitting a PR, make sure your changes follow these rules:

### No `console.log()` in brain or cli

The MCP server communicates over stdio. Any `console.log()` call will corrupt the JSON-RPC stream. Use `console.error()` for logging.

### No LLM calls

VIBE-SPLAIN is a pure static analysis tool. The coding agent provides all synthesis. Never add API calls to LLM services.

### Mermaid `startOnLoad: false`

The Mermaid library must always be initialized with `startOnLoad: false`. Auto-scanning the DOM breaks the React lifecycle.

### Vite `base: './'`

The UI must work from `file://` URLs. Never change the Vite base path to `/` or an absolute URL.

### Atomic writes

All dossier persistence must go through `ExportOrchestrator` (in the CLI package) which coordinates multiple artifacts and uses `ArtifactBundleWriter` for atomic tmp+rename commits. Raw analysis facts are written via `writeAnalysis()` in the brain.

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `npm run build` and ensure it passes with zero errors
4. Test the install command: `node packages/cli/dist/index.js install`
5. Test the MCP server: `node packages/cli/dist/index.js serve`
6. Open a Pull Request with a clear description

## Adding a New MCP Tool

1. Create a new file in `packages/cli/src/mcp/tools/your_tool.ts`
2. Export the tool definition object and handler function
3. Register it in `packages/cli/src/mcp/server.ts`
4. Rebuild with `npm run build`

## Adding a New Pillar Keyword

Edit the `PILLAR_KEYWORDS` map in `packages/brain/src/scanner.ts`. Add the library name to the appropriate pillar category, or create a new one.

## Questions?

Open an issue — happy to help.
