import { join, dirname, relative, extname, sep } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import type { ImportGraph } from '../graph.js';
import type { Language } from '../signals.js';
import type { InventoryResult } from './inventory.js';

// ── Alias map ─────────────────────────────────────────────────────────────────

export interface AliasMap {
  resolvedAliases: Record<string, string>;  // alias prefix → resolved dir (relative to project root)
  workspacePackages: Record<string, string>; // package name → relative dir
}

export interface ResolutionResult {
  aliasMap: AliasMap;
  importedBy: Map<string, Set<string>>;
  importsResolved: Map<string, Set<string>>;
  importsUnresolved: Map<string, Set<string>>;
  fanOut: Map<string, number>;
  graph: ImportGraph;
  unresolvedImports: string[];
  resolutionFailuresByFile: Record<string, string[]>;
  resolutionFailureReasons: Record<string, string>;
}

// ── Lenient JSON parser (strips // and /* */ comments) ───────────────────────

function parseJsonLenient(text: string): unknown {
  const stripped = text
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

// ── tsconfig.json alias extraction (with extends, max 3 levels) ──────────────

async function extractTsConfigPaths(
  tsconfigPath: string,
  projectRoot: string,
  depth = 0,
): Promise<Record<string, string>> {
  if (depth > 3 || !existsSync(tsconfigPath)) return {};

  let raw: string;
  try { raw = await readFile(tsconfigPath, 'utf8'); } catch { return {}; }

  const parsed = parseJsonLenient(raw) as Record<string, unknown> | null;
  if (!parsed) return {};

  const result: Record<string, string> = {};

  // Handle extends chain first (lower priority, overridden by own paths)
  if (typeof parsed.extends === 'string') {
    const baseFile = join(dirname(tsconfigPath), parsed.extends);
    const base = await extractTsConfigPaths(baseFile, projectRoot, depth + 1);
    Object.assign(result, base);
  }

  const opts = (parsed.compilerOptions as Record<string, unknown>) || {};
  const baseUrl = typeof opts.baseUrl === 'string'
    ? join(dirname(tsconfigPath), opts.baseUrl)
    : dirname(tsconfigPath);

  const paths = (opts.paths as Record<string, string[]>) || {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const first = targets[0].replace(/\/\*$/, '');
    const resolved = relative(projectRoot, join(baseUrl, first));
    // Strip trailing /* from alias key too
    const key = alias.replace(/\/\*$/, '');
    result[key] = resolved;
  }

  return result;
}

// ── workspace package discovery ───────────────────────────────────────────────

async function discoverWorkspacePackages(projectRoot: string): Promise<Record<string, string>> {
  const packages: Record<string, string> = {};

  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return packages;

  let rootPkg: Record<string, unknown>;
  try {
    rootPkg = JSON.parse(await readFile(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch { return packages; }

  const workspaces = rootPkg.workspaces;
  const globs: string[] = Array.isArray(workspaces)
    ? workspaces
    : Array.isArray((workspaces as Record<string, unknown>)?.packages)
      ? ((workspaces as Record<string, unknown>).packages as string[])
      : [];

  // Resolve workspace globs — simple prefix matching (packages/*, apps/*)
  for (const glob of globs) {
    const prefix = glob.replace(/\/\*$/, '');
    const absPrefix = join(projectRoot, prefix);
    if (!existsSync(absPrefix)) continue;

    const { readdir } = await import('fs/promises');
    let entries: string[] = [];
    try {
      const dirents = await readdir(absPrefix, { withFileTypes: true });
      entries = dirents.filter(d => d.isDirectory()).map(d => d.name);
    } catch { continue; }

    for (const entry of entries) {
      const wsPkgPath = join(absPrefix, entry, 'package.json');
      if (!existsSync(wsPkgPath)) continue;
      try {
        const wsPkg = JSON.parse(await readFile(wsPkgPath, 'utf8')) as Record<string, unknown>;
        if (typeof wsPkg.name === 'string') {
          packages[wsPkg.name] = relative(projectRoot, join(absPrefix, entry));
        }
      } catch { continue; }
    }
  }

  return packages;
}

// ── Per-app tsconfig paths ────────────────────────────────────────────────────

async function discoverAppTsConfigPaths(projectRoot: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const scanDirs = ['apps', 'packages'];

  for (const scanDir of scanDirs) {
    const absDir = join(projectRoot, scanDir);
    if (!existsSync(absDir)) continue;
    const { readdir } = await import('fs/promises');
    try {
      const entries = await readdir(absDir, { withFileTypes: true });
      for (const entry of entries.filter(e => e.isDirectory())) {
        const tsconfig = join(absDir, entry.name, 'tsconfig.json');
        const paths = await extractTsConfigPaths(tsconfig, projectRoot);
        Object.assign(result, paths);
      }
    } catch { continue; }
  }

  return result;
}

// ── Fallback conventional aliases ────────────────────────────────────────────

const CONVENTIONAL_ALIASES: Array<{ prefix: string; replacement: string }> = [
  { prefix: '~/',            replacement: '' },
  { prefix: '@components/',  replacement: 'components/' },
  { prefix: '@lib/',         replacement: 'lib/' },
  { prefix: '@server/',      replacement: 'server/' },
  { prefix: '@calcom/web/',  replacement: '' },
  { prefix: '@calcom/features/', replacement: '../packages/features/' },
  { prefix: '@calcom/lib/',  replacement: '../packages/lib/' },
  { prefix: '@calcom/prisma/', replacement: '../packages/prisma/' },
  { prefix: '@calcom/trpc/', replacement: '../packages/trpc/' },
  { prefix: '@calcom/ui/',   replacement: '../packages/ui/' },
  { prefix: '@calcom/emails/', replacement: '../packages/emails/' },
];

// ── Build the full alias map ──────────────────────────────────────────────────

async function buildAliasMap(projectRoot: string): Promise<AliasMap> {
  // 1. Root tsconfig.json
  const rootPaths = await extractTsConfigPaths(
    join(projectRoot, 'tsconfig.json'),
    projectRoot,
  );

  // 2. Workspace packages
  const workspacePackages = await discoverWorkspacePackages(projectRoot);

  // 3. Per-app tsconfig paths (lower priority than root)
  const appPaths = await discoverAppTsConfigPaths(projectRoot);

  // Merge: root paths win over app paths
  const resolvedAliases: Record<string, string> = { ...appPaths, ...rootPaths };

  // Add workspace package names as aliases (if not already in tsconfig paths)
  for (const [pkgName, pkgDir] of Object.entries(workspacePackages)) {
    if (!(pkgName in resolvedAliases)) {
      resolvedAliases[pkgName] = pkgDir;
    }
  }

  return { resolvedAliases, workspacePackages };
}

// ── Import resolution ─────────────────────────────────────────────────────────

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function tryJsCandidates(base: string, projectRoot: string, fileSet: Set<string>): string | null {
  const candidates: string[] = [];
  candidates.unshift(base);
  for (const ext of JS_EXTS) candidates.push(base + ext);
  for (const ext of JS_EXTS) candidates.push(join(base, 'index' + ext));
  for (const c of candidates) {
    const rel = relative(projectRoot, c);
    if (fileSet.has(rel)) return rel;
  }
  return null;
}

function resolvePython(spec: string, fromAbs: string, projectRoot: string, fileSet: Set<string>): string | null {
  let modulePath: string;
  if (spec.startsWith('.')) {
    const dots = spec.match(/^\.+/)![0].length;
    let dir = dirname(fromAbs);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    const rest = spec.slice(dots).replace(/\./g, sep);
    modulePath = rest ? join(dir, rest) : dir;
  } else {
    modulePath = join(projectRoot, spec.replace(/\./g, sep));
  }
  for (const c of [modulePath + '.py', join(modulePath, '__init__.py')]) {
    if (fileSet.has(relative(projectRoot, c))) return relative(projectRoot, c);
  }
  return null;
}

function resolveGeneric(
  spec: string,
  projectRoot: string,
  fileSet: Set<string>,
  basenameIndex: Map<string, string[]>,
): string | null {
  const normalized = spec.replace(/^crate::/, '').replace(/::/g, '/').replace(/\./g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  for (const rel of fileSet) {
    const noExt = rel.slice(0, rel.length - extname(rel).length);
    if (noExt.endsWith(parts.join(sep))) return rel;
  }
  const byBase = basenameIndex.get(last);
  if (byBase && byBase.length === 1) return byBase[0];
  return null;
}

export function resolveImportWithAliasMap(
  spec: string,
  fromAbs: string,
  lang: Language,
  projectRoot: string,
  fileSet: Set<string>,
  basenameIndex: Map<string, string[]>,
  aliasMap: AliasMap,
): { resolved: string | null; isAlias: boolean; reason?: string } {
  if (lang === 'python') {
    return { resolved: resolvePython(spec, fromAbs, projectRoot, fileSet), isAlias: false };
  }

  if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
    // Relative import
    if (spec.startsWith('.')) {
      const base = join(dirname(fromAbs), spec);
      return { resolved: tryJsCandidates(base, projectRoot, fileSet), isAlias: false };
    }

    // Try tsconfig.json / workspace alias map
    for (const [prefix, replacement] of Object.entries(aliasMap.resolvedAliases)) {
      if (spec === prefix || spec.startsWith(prefix + '/')) {
        const rest = spec.slice(prefix.length).replace(/^\//, '');
        const base = join(projectRoot, replacement, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        return { resolved, isAlias: true, reason: resolved ? undefined : `alias '${prefix}' found but path '${replacement}/${rest}' not in file set` };
      }
    }

    // Try workspace packages (package name → dir)
    for (const [pkgName, pkgDir] of Object.entries(aliasMap.workspacePackages)) {
      if (spec === pkgName || spec.startsWith(pkgName + '/')) {
        const rest = spec.slice(pkgName.length).replace(/^\//, '');
        const base = join(projectRoot, pkgDir, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        return { resolved, isAlias: true, reason: resolved ? undefined : `workspace package '${pkgName}' found but subpath '${rest}' not in file set` };
      }
    }

    // Fallback: conventional aliases
    for (const { prefix, replacement } of CONVENTIONAL_ALIASES) {
      if (spec.startsWith(prefix)) {
        const rest = replacement + spec.slice(prefix.length);
        const base = join(projectRoot, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        return { resolved, isAlias: true, reason: resolved ? undefined : `conventional alias '${prefix}' → path not found` };
      }
    }

    return { resolved: null, isAlias: false }; // external package
  }

  return { resolved: resolveGeneric(spec, projectRoot, fileSet, basenameIndex), isAlias: false };
}

// ── Main stage implementation ─────────────────────────────────────────────────

export async function runResolution(
  projectRoot: string,
  inv: InventoryResult,
): Promise<ResolutionResult> {
  const aliasMap = await buildAliasMap(projectRoot);

  const { work, fileSet, basenameIndex } = inv;

  // Init per-file maps
  const importedBy = new Map<string, Set<string>>();
  const importsResolved = new Map<string, Set<string>>();
  const importsUnresolved = new Map<string, Set<string>>();
  const fanOut = new Map<string, number>();
  for (const w of work) {
    importedBy.set(w.rel, new Set());
    importsResolved.set(w.rel, new Set());
    importsUnresolved.set(w.rel, new Set());
  }

  const graph: ImportGraph = { nodes: {}, edges: [] };
  for (const w of work) {
    graph.nodes[w.rel] = { imports: w.importSpecs };
  }

  const resolutionFailuresByFile: Record<string, string[]> = {};
  const resolutionFailureReasons: Record<string, string> = {};
  const unresolvedSet = new Set<string>();

  // Resolve all imports
  for (const w of work) {
    const distinctModules = new Set<string>();
    for (const spec of w.importSpecs) {
      distinctModules.add(spec);
      const { resolved, isAlias, reason } = resolveImportWithAliasMap(
        spec, w.abs, w.lang, projectRoot, fileSet, basenameIndex, aliasMap,
      );

      if (resolved && resolved !== w.rel && importedBy.has(resolved)) {
        importedBy.get(resolved)!.add(w.rel);
        importsResolved.get(w.rel)!.add(resolved);
        graph.edges.push({ from: w.rel, to: resolved });
      } else if (resolved === null && isAlias) {
        importsUnresolved.get(w.rel)!.add(spec);
        unresolvedSet.add(spec);
        if (reason) {
          if (!resolutionFailuresByFile[w.rel]) resolutionFailuresByFile[w.rel] = [];
          resolutionFailuresByFile[w.rel].push(spec);
          if (!resolutionFailureReasons[spec]) resolutionFailureReasons[spec] = reason;
        }
      }
    }
    fanOut.set(w.rel, distinctModules.size);
  }

  const unresolvedImports = [...unresolvedSet];

  // Write stage artifact
  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });
  const stage04 = {
    resolvedAliases: aliasMap.resolvedAliases,
    workspacePackages: aliasMap.workspacePackages,
    unresolvedImports,
    resolutionFailuresByFile,
    resolutionFailureReasons,
  };
  await writeFile(join(dir, 'stage-04-aliases.json'), JSON.stringify(stage04, null, 2), 'utf8');

  return {
    aliasMap, importedBy, importsResolved, importsUnresolved,
    fanOut, graph, unresolvedImports, resolutionFailuresByFile, resolutionFailureReasons,
  };
}
