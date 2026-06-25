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

// ── tsconfig.json alias extraction (with recursive discovery) ──────────────

const TSCONFIG_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', '.cache',
  '.vibesplain', '__pycache__', 'target', '.mypy_cache', '.pytest_cache',
  '.tox', 'venv', '.venv', 'env', 'site-packages', 'vendor',
]);

async function discoverAllTsConfigs(dir: string, projectRoot: string, maxDepth = 4): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (maxDepth < 0) return result;

  const { readdir } = await import('fs/promises');
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch { return result; }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (TSCONFIG_SKIP_DIRS.has(entry.name)) continue;
      const sub = await discoverAllTsConfigs(fullPath, projectRoot, maxDepth - 1);
      Object.assign(result, sub);
    } else if (entry.name === 'tsconfig.json') {
      const paths = await extractTsConfigPaths(fullPath, projectRoot);
      Object.assign(result, paths);
    }
  }

  return result;
}

async function extractTsConfigPaths(
  tsconfigPath: string,
  projectRoot: string,
  depth = 0,
): Promise<Record<string, string>> {
  if (depth > 3 || !existsSync(tsconfigPath)) return {};

  let raw: string;
  try { raw = await readFile(tsconfigPath, 'utf8'); } catch { return {}; }

  const parsed = parseJsonLenient(raw) as Record<string, any> | null;
  if (!parsed) return {};

  const result: Record<string, string> = {};

  // Handle extends chain
  if (typeof parsed.extends === 'string') {
    let baseFile = parsed.extends;
    if (baseFile.startsWith('.')) {
      baseFile = join(dirname(tsconfigPath), baseFile);
    } else {
      // Might be a node_modules base (e.g. @tsconfig/node18/tsconfig.json)
      // Search upwards for node_modules (ADR-020 Monorepo Support)
      let currentDir = dirname(tsconfigPath);
      let found = false;
      while (currentDir.length >= projectRoot.length || currentDir === projectRoot) {
        const candidate = join(currentDir, 'node_modules', baseFile + (baseFile.endsWith('.json') ? '' : '.json'));
        if (existsSync(candidate)) {
          baseFile = candidate;
          found = true;
          break;
        }
        const parent = dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
      }
      if (!found) {
        // Fallback to project root node_modules
        baseFile = join(projectRoot, 'node_modules', baseFile);
        if (!baseFile.endsWith('.json')) baseFile += '.json';
      }
    }
    const base = await extractTsConfigPaths(baseFile, projectRoot, depth + 1);
    Object.assign(result, base);
  }

  const opts = parsed.compilerOptions || {};
  const baseUrl = typeof opts.baseUrl === 'string'
    ? join(dirname(tsconfigPath), opts.baseUrl)
    : dirname(tsconfigPath);

  // ADR-020: If baseUrl is set, everything under it is an implicit alias
  if (typeof opts.baseUrl === 'string') {
    const relBase = relative(projectRoot, baseUrl);
    if (relBase && relBase !== '.') {
      result[''] = relBase; // special key for baseUrl-relative resolution
    }
  }

  const paths = opts.paths || {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const first = (targets[0] as string).replace(/\/\*$/, '');
    const resolved = relative(projectRoot, join(baseUrl, first));
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

// ── Fallback conventional aliases ────────────────────────────────────────────

const CONVENTIONAL_ALIASES: Array<{ prefix: string; replacement: string }> = [
  { prefix: '~/',            replacement: 'modules/' },
  { prefix: '~/',            replacement: '' },
  { prefix: '@components/',  replacement: 'components/' },
  { prefix: '@lib/',         replacement: 'lib/' },
  { prefix: '@server/',      replacement: 'server/' },
];

// ── Build the full alias map ──────────────────────────────────────────────────

async function buildAliasMap(projectRoot: string): Promise<AliasMap> {
  // 1. Recursive tsconfig.json discovery (ADR-020)
  const allPaths = await discoverAllTsConfigs(projectRoot, projectRoot);

  // 2. Workspace packages
  const workspacePackages = await discoverWorkspacePackages(projectRoot);

  // Merge: tsconfig paths take precedence
  const resolvedAliases: Record<string, string> = { ...allPaths };

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
      if (prefix === '') continue; // skip baseUrl marker
      if (spec === prefix || spec.startsWith(prefix + '/')) {
        const rest = spec.slice(prefix.length).replace(/^\//, '');
        const base = join(projectRoot, replacement, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        if (resolved) return { resolved, isAlias: true };
      }
    }

    // ADR-020: baseUrl absolute imports (marker '')
    if (aliasMap.resolvedAliases[''] !== undefined) {
      const base = join(projectRoot, aliasMap.resolvedAliases[''], spec);
      const resolved = tryJsCandidates(base, projectRoot, fileSet);
      if (resolved) return { resolved, isAlias: true };
    }

    // Try workspace packages (package name → dir)
    for (const [pkgName, pkgDir] of Object.entries(aliasMap.workspacePackages)) {
      if (spec === pkgName || spec.startsWith(pkgName + '/')) {
        const rest = spec.slice(pkgName.length).replace(/^\//, '');
        const base = join(projectRoot, pkgDir, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        if (resolved) return { resolved, isAlias: true };
      }
    }

    // Fallback: conventional aliases
    let matchedPrefix = false;
    for (const { prefix, replacement } of CONVENTIONAL_ALIASES) {
      if (spec.startsWith(prefix)) {
        matchedPrefix = true;
        const rest = replacement + spec.slice(prefix.length);
        const base = join(projectRoot, rest);
        const resolved = tryJsCandidates(base, projectRoot, fileSet);
        if (resolved) return { resolved, isAlias: true };
      }
    }
    if (matchedPrefix) return { resolved: null, isAlias: true };

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

  // Resolve all imports — cache per (abs, spec) to avoid repeated alias iteration
  const resolveCache = new Map<string, { resolved: string | null; isAlias: boolean; reason?: string }>();
  for (const w of work) {
    const distinctModules = new Set<string>();
    for (const spec of w.importSpecs) {
      distinctModules.add(spec);
      const cacheKey = `${w.abs}\0${spec}`;
      let cached = resolveCache.get(cacheKey);
      if (!cached) {
        cached = resolveImportWithAliasMap(spec, w.abs, w.lang, projectRoot, fileSet, basenameIndex, aliasMap);
        resolveCache.set(cacheKey, cached);
      }
      const { resolved, isAlias, reason } = cached;

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
  const dir = join(projectRoot, '.vibesplain');
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
