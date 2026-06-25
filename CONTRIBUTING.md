# Contributing to vibesplain

Thanks for your interest in contributing. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/abp2204/vibesplain.git
cd vibesplain
npm install
npm run build
```

## Project Structure

This is an npm workspaces monorepo with three packages:

| Package | Path | Purpose |
|---------|------|---------|
| `@vibesplain/brain` | `packages/brain/` | Tree-Sitter analysis engine (pure, no I/O side effects) |
| `vibesplain` | `packages/cli/` | MCP server + CLI (published to npm) |
| `@vibesplain/ui` | `packages/ui/` | React dossier viewer (embedded into cli at build time) |

Build order matters: **brain → cli → ui → bundle-ui**.

## Rules

### No `console.log()` in brain or cli

The MCP server communicates over stdio. Any `console.log()` will corrupt the JSON-RPC stream. Use `console.error()` for all logging.

### No LLM calls

vibesplain is pure static analysis. The coding agent provides all synthesis. Never add API calls to LLM services.

### No HTTP server or bound port

The UI is served from `file://`. Do not add any server that binds a port.

### Mermaid `startOnLoad: false`

Always initialize Mermaid with `startOnLoad: false`. Auto-scanning the DOM breaks the React lifecycle.

### Vite `base: './'`

The UI must work from `file://` URLs. Never change the Vite base path.

### Atomic writes

All dossier persistence goes through `ExportOrchestrator` → `ArtifactBundleWriter` (atomic tmp+rename). Raw analysis facts are written via `writeAnalysis()` in the brain.

## Submitting Changes

1. Fork the repo and create a feature branch
2. Make your changes
3. Run `npm run build` — zero errors required
4. Run `npm run test:regression` — all tests must pass
5. Test locally: `node packages/cli/dist/index.js install` and `serve`
6. Open a Pull Request with a clear description

## Adding a New MCP Tool

1. Create `packages/cli/src/mcp/tools/your_tool.ts`
2. Export a tool definition object and a handler function
3. Register both in `packages/cli/src/mcp/server.ts`
4. Rebuild

## Adding a New Pillar Keyword

Edit `PILLAR_KEYWORDS` in `packages/brain/src/pipeline/inventory.ts`. Add the library name to the appropriate pillar bucket, or create a new one.

## Questions?

Open an issue — happy to help.
