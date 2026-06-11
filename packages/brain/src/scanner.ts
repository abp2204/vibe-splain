import Parser from 'web-tree-sitter';
import { join, dirname, relative, extname, basename, sep } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { writeGraph, type ImportGraph } from './graph.js';
import { writeAnalysis, type PersistedFile, type AnalysisStore } from './analysis.js';
import type {
  Language, GravitySignals, HeatSignals, SmellHit, SmellKind, FileAnalysis,
} from './signals.js';
import type { ProjectMap, PillarDef } from './dossier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let parser: Parser | null = null;

// ── Per-language grammar loading (cached) ──────────────────────────────────
const langCache = new Map<Language, Parser.Language>();

const EXT_LANG: Record<string, Language> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'tsx',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
};

const LANG_WASM: Record<Language, string> = {
  typescript: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm', python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm', rust: 'tree-sitter-rust.wasm', java: 'tree-sitter-java.wasm',
};

const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_LANG));

function resolveWasm(file: string): string | null {
  try {
    const wasmsDir = dirname(require.resolve('tree-sitter-wasms/package.json'));
    const p = join(wasmsDir, 'out', file);
    if (existsSync(p)) return p;
  } catch { /* fall through */ }
  const local = join(__dirname, '../wasm', file);
  return existsSync(local) ? local : null;
}

async function getLanguage(lang: Language): Promise<Parser.Language | null> {
  const cached = langCache.get(lang);
  if (cached) return cached;
  const wasm = resolveWasm(LANG_WASM[lang]);
  if (!wasm) {
    console.error(`[vibe-splain] grammar missing for ${lang} (${LANG_WASM[lang]}); skipping language`);
    return null;
  }
  try {
    const loaded = await Parser.Language.load(wasm);
    langCache.set(lang, loaded);
    return loaded;
  } catch (err) {
    console.error(`[vibe-splain] failed to load grammar for ${lang}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function initParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init(); // once per process
  parser = new Parser();
  // Warm the most common grammar so existing callers behave.
  const ts = await getLanguage('typescript');
  if (ts) parser.setLanguage(ts);
  return parser;
}

async function parseAs(lang: Language, source: string): Promise<Parser.Tree | null> {
  const p = await initParser();
  const language = await getLanguage(lang);
  if (!language) return null;
  p.setLanguage(language);
  try {
    return p.parse(source);
  } catch {
    return null;
  }
}

// ── File collection ────────────────────────────────────────────────────────
const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out', '.vibe-splainer', '.git',
  '.venv', 'venv', 'env', '__pycache__', '.idea', '.vscode', '.cache',
  'site-packages', 'target', '.tox', '.mypy_cache', '.pytest_cache',
]);
const EXCLUDE_FILE_PATTERNS = [/\.lock$/, /\.min\.[a-z]+$/, /\.d\.ts$/];

// Path segments that mean "not the real application" (kept but demoted).
const DEMOTE_SEGMENTS = new Set([
  'docs', 'doc', 'examples', 'example', 'samples', 'sample',
  'mockup', 'mockups', 'fixtures', 'fixture', '__generated__', '__mocks__',
]);
const VENDOR_SEGMENTS = new Set([
  'node_modules', 'vendor', 'vendored', 'site-packages', 'third_party', 'third-party',
]);

// ── Level 0 heuristic: keyword-based pillar matching ──────────────────────────
const PILLAR_KEYWORDS: Record<string, string[]> = {
  'Auth':     ['passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', 'oauth', 'session',
               'cookie-parser', 'next-auth', '@auth/', 'lucia', 'clerk', '@clerk/',
               'supabase/auth', '@supabase/auth-helpers', 'iron-session', 'jose', 'jwt',
               '@auth/core', 'arctic'],
  'Database': ['prisma', '@prisma/', 'mongoose', 'sequelize', 'typeorm', 'knex',
               'pg', 'mysql', 'mysql2', 'better-sqlite3', 'drizzle-orm', 'drizzle',
               'kysely', '@supabase/supabase-js', 'mongodb', 'redis', 'ioredis'],
  'Payments': ['stripe', '@stripe/', 'paypal', 'braintree', 'plaid', 'lemonsqueezy',
               '@lemonsqueezy/', 'paddle', 'lemon-squeezy'],
  'Routing':  ['express', 'fastify', 'koa', 'koa-router', 'next/router',
               'next/navigation', 'react-router', '@remix-run/', 'hono',
               'express-rate-limit', 'cors', 'helmet'],
  'Queue':    ['bull', 'bullmq', 'amqplib', 'kafkajs', 'kafka',
               'upstash', '@upstash/', 'bee-queue', 'agenda'],
  'Storage':  ['aws-sdk', '@aws-sdk/', 'multer', 'cloudinary',
               '@google-cloud/storage', 'minio', '@vercel/blob',
               'sharp', 'imagekit'],
  'Config':   ['dotenv', 'convict', 'env-var', '@t3-oss/env',
               'envalid'],
  'Email':    ['nodemailer', 'resend', '@sendgrid/', 'postmark', '@resend/',
               'mailgun'],
  'Realtime': ['socket.io', 'ws', 'pusher', 'ably', '@supabase/realtime',
               'socket.io-client'],
};

const PILLAR_PATH_PATTERNS: Record<string, RegExp> = {
  'Auth':     /(?:^|[\/\\])(?:auth|login|signup|register|session|oauth)(?:[\/\\]|$)/i,
  'Database': /(?:^|[\/\\])(?:db|database|models?|schema|migrations?|seeds?)(?:[\/\\]|$)/i,
  'Payments': /(?:^|[\/\\])(?:pay|payments?|billing|checkout|subscriptions?|stripe)(?:[\/\\]|$)/i,
  'Routing':  /(?:^|[\/\\])(?:routes?|router|middleware|api)(?:[\/\\]|$)/i,
  'Queue':    /(?:^|[\/\\])(?:queues?|workers?|jobs?|consumers?|producers?)(?:[\/\\]|$)/i,
  'Storage':  /(?:^|[\/\\])(?:storage|uploads?|s3|blobs?|media)(?:[\/\\]|$)/i,
  'Config':   /(?:^|[\/\\])(?:config|env|settings?)(?:[\/\\]|$)/i,
  'Email':    /(?:^|[\/\\])(?:emails?|mail|notifications?)(?:[\/\\]|$)/i,
};

// Meaningless path segments to skip when generating pillar names
const MEANINGLESS_SEGMENTS = new Set([
  'src', 'lib', 'app', 'pages', 'components', 'modules', 'features',
  'core', 'common', 'shared', 'internal', 'pkg', 'packages',
]);

function matchPillarByImports(importSpecs: string[]): string | null {
  const scores = new Map<string, number>();
  for (const spec of importSpecs) {
    for (const [pillar, keywords] of Object.entries(PILLAR_KEYWORDS)) {
      if (keywords.some(kw => spec === kw || spec.startsWith(kw + '/'))) {
        scores.set(pillar, (scores.get(pillar) || 0) + 1);
      }
    }
  }
  if (scores.size === 0) return null;
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function matchPillarByPath(relPath: string): string | null {
  for (const [pillar, pattern] of Object.entries(PILLAR_PATH_PATTERNS)) {
    if (pattern.test(relPath)) return pillar;
  }
  return null;
}

async function collectFiles(dir: string, projectRoot: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      // Skip dotdirs/dotfiles except keep nothing hidden; covered by EXCLUDE_DIRS too.
      if (entry.isDirectory()) continue;
    }
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, projectRoot, acc);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      if (EXCLUDE_FILE_PATTERNS.some(p => p.test(entry.name))) continue;
      acc.push(fullPath);
    }
  }
}

function pathDemoteReason(relPath: string): string | null {
  const segs = relPath.split(sep);
  for (const s of segs) {
    if (VENDOR_SEGMENTS.has(s)) return `vendored code (${s})`;
    if (s.endsWith('.venv') || s === 'venv' || s === 'env') return 'virtual environment';
  }
  for (const s of segs) {
    if (DEMOTE_SEGMENTS.has(s.toLowerCase())) return `non-application path segment (${s})`;
  }
  const base = basename(relPath);
  if (/\.min\./.test(base)) return 'minified bundle';
  if (/\.generated\./.test(base)) return 'generated file';
  return null;
}

// ── Import extraction (language-aware) ──────────────────────────────────────
function extractImports(source: string, lang: Language): string[] {
  const specs: string[] = [];
  if (lang === 'python') {
    const re = /^[ \t]*(?:from[ \t]+([.\w]+)[ \t]+import|import[ \t]+([.\w][.\w ,]*))/gm;
    let m;
    while ((m = re.exec(source)) !== null) {
      if (m[1]) {
        specs.push(m[1]);
      } else if (m[2]) {
        for (const part of m[2].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name) specs.push(name);
        }
      }
    }
    return specs;
  }
  if (lang === 'go') {
    const re = /"([^"]+)"/g;
    // crude: only inside import blocks; approximate by scanning all quoted strings on import lines
    const importBlock = source.match(/import\s*\(([\s\S]*?)\)/g) || [];
    for (const block of importBlock) {
      let m; while ((m = re.exec(block)) !== null) specs.push(m[1]);
    }
    const single = /import\s+(?:\w+\s+)?"([^"]+)"/g;
    let m; while ((m = single.exec(source)) !== null) specs.push(m[1]);
    return specs;
  }
  if (lang === 'rust') {
    const re = /\b(?:use|mod)\s+([\w:]+)/g;
    let m; while ((m = re.exec(source)) !== null) specs.push(m[1]);
    return specs;
  }
  if (lang === 'java') {
    const re = /import\s+(?:static\s+)?([\w.]+)/g;
    let m; while ((m = re.exec(source)) !== null) specs.push(m[1]);
    return specs;
  }
  // JS/TS family
  const re = /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1] || m[2]);
  }
  return specs;
}

// ── Import resolution to internal files (single, deduped) ───────────────────
const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveImport(
  spec: string,
  fromAbs: string,
  lang: Language,
  projectRoot: string,
  fileSet: Set<string>,
  basenameIndex: Map<string, string[]>,
): string | null {
  if (lang === 'python') {
    return resolvePython(spec, fromAbs, projectRoot, fileSet);
  }
  if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
    if (!spec.startsWith('.')) return null; // external package
    const base = join(dirname(fromAbs), spec);
    return tryJsCandidates(base, projectRoot, fileSet);
  }
  // go / rust / java — best-effort suffix/basename match
  return resolveGeneric(spec, projectRoot, fileSet, basenameIndex);
}

function tryJsCandidates(base: string, projectRoot: string, fileSet: Set<string>): string | null {
  const candidates: string[] = [];
  for (const ext of JS_EXTS) candidates.push(base + ext);
  for (const ext of JS_EXTS) candidates.push(join(base, 'index' + ext));
  // bare (already has extension)
  candidates.unshift(base);
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
  const candidates = [modulePath + '.py', join(modulePath, '__init__.py')];
  for (const c of candidates) {
    const rel = relative(projectRoot, c);
    if (fileSet.has(rel)) return rel;
  }
  // absolute module that doesn't sit at root: try basename match
  if (!spec.startsWith('.')) {
    const last = spec.split('.').pop()!;
    // handled by generic basename index in caller if needed
    void last;
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
  // suffix match against known files (path without extension)
  for (const rel of fileSet) {
    const noExt = rel.slice(0, rel.length - extname(rel).length);
    if (noExt.endsWith(parts.join(sep))) return rel;
  }
  const byBase = basenameIndex.get(last);
  if (byBase && byBase.length === 1) return byBase[0];
  return null;
}

// ── AST analysis (file-local signals + smells + hot spans + signature) ──────
const FUNCTION_TYPES = new Set([
  'function_declaration', 'function', 'function_expression', 'arrow_function',
  'method_definition', 'function_definition', 'method_declaration',
  'func_literal', 'function_item', 'closure_expression', 'constructor_declaration',
  'generator_function_declaration', 'generator_function',
]);

const NESTING_TYPES = new Set([
  'function_declaration', 'function', 'arrow_function', 'function_expression',
  'method_definition', 'function_definition', 'method_declaration', 'function_item',
  'class_declaration', 'class', 'class_definition', 'class_item',
  'if_statement', 'if_expression', 'for_statement', 'for_in_statement',
  'for_expression', 'enhanced_for_statement', 'while_statement', 'while_expression',
  'do_statement', 'switch_statement', 'match_expression', 'match_arm',
  'try_statement', 'catch_clause', 'except_clause', 'loop_expression', 'block',
]);

const DECISION_TYPES = new Set([
  'if_statement', 'if_expression', 'elif_clause',
  'for_statement', 'for_in_statement', 'for_expression', 'enhanced_for_statement',
  'while_statement', 'while_expression', 'do_statement', 'loop_expression',
  'case', 'switch_case', 'case_clause', 'match_arm',
  'catch_clause', 'except_clause', 'communication_case',
  'conditional_expression', 'ternary_expression',
]);

const CATCH_TYPES = new Set(['catch_clause', 'except_clause']);

interface AstAnalysis {
  language: Language;
  loc: number;
  cyclomatic: number;
  maxNesting: number;
  publicSurface: number;
  exportedNames: string[];
  signature: string;
  longFunctions: number;
  magicNumbers: number;
  swallowedCatches: number;
  smells: SmellHit[];
  hotSpans: { startLine: number; endLine: number; snippet: string; reason: string }[];
}

const LONG_FN_LOC = 60;
const DEEP_NESTING = 5;
const GOD_FILE_LOC = 400;
const GOD_FILE_EXPORTS = 8;

function nodeLOC(node: Parser.SyntaxNode): number {
  return node.endPosition.row - node.startPosition.row + 1;
}

function countDecisions(node: Parser.SyntaxNode): number {
  let count = 0;
  const walk = (n: Parser.SyntaxNode) => {
    if (DECISION_TYPES.has(n.type)) count++;
    if (n.type === 'binary_expression') {
      const op = n.children.find(c => c.type === '&&' || c.type === '||');
      if (op) count++;
    }
    if (n.type === 'boolean_operator') count++; // python and/or
    for (const c of n.children) walk(c);
  };
  walk(node);
  return count;
}

function computeNesting(node: Parser.SyntaxNode, depth: number): number {
  let maxDepth = depth;
  for (const child of node.children) {
    const nextDepth = NESTING_TYPES.has(child.type) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, computeNesting(child, nextDepth));
  }
  return maxDepth;
}

function isExported(node: Parser.SyntaxNode, lang: Language): boolean {
  if (lang === 'python') {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || '';
    return !name.startsWith('_');
  }
  if (lang === 'go') {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || '';
    return /^[A-Z]/.test(name);
  }
  if (lang === 'rust') {
    return node.children.some(c => c.type === 'visibility_modifier');
  }
  if (lang === 'java') {
    return node.text.startsWith('public') || /\bpublic\b/.test(firstLine(node.text));
  }
  // js/ts: exported if ancestor is export_statement
  let p = node.parent;
  while (p) {
    if (p.type === 'export_statement') return true;
    p = p.parent;
  }
  return false;
}

function firstLine(s: string): string {
  return s.split('\n')[0];
}

function stripLeadingComments(snippet: string): string {
  const lines = snippet.split('\n');
  let i = 0;
  let inBlock = false;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      i++;
      continue;
    }
    if (t === '') { i++; continue; }
    if (t.startsWith('//') || t.startsWith('#')) { i++; continue; }
    if (t.startsWith('/*')) {
      inBlock = !t.includes('*/');
      i++;
      continue;
    }
    // python docstring at body start
    if (t.startsWith('"""') || t.startsWith("'''")) {
      const q = t.slice(0, 3);
      if (t.length > 3 && t.endsWith(q)) { i++; continue; }
      i++;
      while (i < lines.length && !lines[i].includes(q)) i++;
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}

const TODO_RE = /\b(TODO|FIXME|HACK|XXX|KLUDGE)\b|@deprecated/;
const SUPPRESS_RE = /@ts-ignore|@ts-nocheck|eslint-disable|:\s*any\b|#\s*type:\s*ignore|type:\s*ignore|#\s*nosec/;

function collectFunctionNodes(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const walk = (n: Parser.SyntaxNode) => {
    if (FUNCTION_TYPES.has(n.type)) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

function catchIsSwallowed(node: Parser.SyntaxNode, lang: Language): boolean {
  // body is empty, or only contains log/print statements
  const bodyText = node.text;
  const inner = bodyText.replace(/^[^{:]*[{:]/, ''); // drop header
  const meaningful = inner
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('#') && l !== '}' && l !== 'pass');
  if (meaningful.length === 0) return true;
  const onlyLogs = meaningful.every(l =>
    /^(console\.(log|error|warn|info)|print|println!?|System\.out|logger?\.)/.test(l) ||
    l === 'pass' || l === '{' || l === '});' || l === ')' || l === '`' );
  return onlyLogs;
}

function analyzeAst(source: string, lang: Language, tree: Parser.Tree): AstAnalysis {
  const root = tree.rootNode;
  const lines = source.split('\n');
  const loc = lines.length;
  const cyclomatic = countDecisions(root);
  const maxNesting = computeNesting(root, 0);

  const smells: SmellHit[] = [];

  // ── regex smells: todos + suppressions ──
  let todos = 0, suppressions = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TODO_RE.test(line)) {
      todos++;
      smells.push({ kind: 'todo', line: i + 1, endLine: i + 1, text: line.trim().slice(0, 200), severity: 2, note: 'unfinished / known-bad marker' });
    }
    if (SUPPRESS_RE.test(line)) {
      suppressions++;
      smells.push({ kind: 'suppression', line: i + 1, endLine: i + 1, text: line.trim().slice(0, 200), severity: 3, note: 'type/lint safety suppressed' });
    }
  }

  // ── magic numbers (rough): bare numeric literals != 0/1/-1/2 in expressions ──
  let magicNumbers = 0;
  const magicWalk = (n: Parser.SyntaxNode) => {
    if (n.type === 'number' || n.type === 'integer_literal' || n.type === 'float_literal' || n.type === 'int_literal') {
      const v = n.text.replace(/_/g, '');
      if (!['0', '1', '2', '-1', '100', '1000'].includes(v) && /^\d{2,}$/.test(v)) {
        magicNumbers++;
      }
    }
    for (const c of n.children) magicWalk(c);
  };
  magicWalk(root);
  // cap magic-number smell spam: only flag a few representative
  if (magicNumbers > 6) {
    smells.push({ kind: 'magic-number', line: 1, endLine: 1, text: `${magicNumbers} unexplained numeric literals`, severity: 2, note: 'many magic numbers — extract named constants' });
  }

  // ── swallowed catches ──
  let swallowedCatches = 0;
  const catchWalk = (n: Parser.SyntaxNode) => {
    if (CATCH_TYPES.has(n.type) && catchIsSwallowed(n, lang)) {
      swallowedCatches++;
      smells.push({
        kind: 'swallowed-catch', line: n.startPosition.row + 1, endLine: n.endPosition.row + 1,
        text: firstLine(n.text).trim().slice(0, 200), severity: 4, note: 'catch block swallows error silently',
      });
    }
    for (const c of n.children) catchWalk(c);
  };
  catchWalk(root);

  // ── functions: long-function + deep-nesting + hot spans ──
  const fnNodes = collectFunctionNodes(root);
  let longFunctions = 0;
  const scored: { node: Parser.SyntaxNode; decisions: number; bodyLOC: number; score: number }[] = [];
  for (const fn of fnNodes) {
    const bodyLOC = nodeLOC(fn);
    const decisions = countDecisions(fn);
    scored.push({ node: fn, decisions, bodyLOC, score: decisions + bodyLOC });
    if (bodyLOC > LONG_FN_LOC) {
      longFunctions++;
      smells.push({
        kind: 'long-function', line: fn.startPosition.row + 1, endLine: fn.endPosition.row + 1,
        text: firstLine(fn.text).trim().slice(0, 200), severity: 3, note: `function body is ${bodyLOC} lines`,
      });
    }
  }
  if (maxNesting > DEEP_NESTING) {
    smells.push({ kind: 'deep-nesting', line: 1, endLine: 1, text: `nesting depth ${maxNesting}`, severity: 3, note: `control flow nested ${maxNesting} levels deep` });
  }

  // ── exports / public surface / signature ──
  const exported = collectExports(root, lang);
  const publicSurface = exported.length;
  const signature = exported.map(e => e.text).join('\n').slice(0, 4000);

  if (loc > GOD_FILE_LOC && publicSurface > GOD_FILE_EXPORTS) {
    smells.push({
      kind: 'god-file', line: 1, endLine: 1,
      text: `${loc} LOC, ${publicSurface} exports`, severity: 4,
      note: `god-file: ${loc} lines exporting ${publicSurface} symbols`,
    });
  }

  // ── hot spans: top-3 by complexity, comment-stripped ──
  scored.sort((a, b) => b.score - a.score);
  const hotSpans = scored.slice(0, 3).filter(s => s.bodyLOC >= 4).map(s => {
    const raw = source.split('\n').slice(s.node.startPosition.row, s.node.endPosition.row + 1).join('\n');
    const snippet = stripLeadingComments(raw).slice(0, 2000);
    return {
      startLine: s.node.startPosition.row + 1,
      endLine: s.node.endPosition.row + 1,
      snippet,
      reason: `high complexity: ${s.decisions} decision branches across ${s.bodyLOC} lines`,
    };
  });

  return {
    language: lang, loc, cyclomatic, maxNesting, publicSurface,
    exportedNames: exported.map(e => e.name), signature,
    longFunctions, magicNumbers, swallowedCatches, smells, hotSpans,
  };
}

interface ExportInfo { name: string; text: string; }

function collectExports(root: Parser.SyntaxNode, lang: Language): ExportInfo[] {
  const out: ExportInfo[] = [];
  const seen = new Set<string>();
  const push = (name: string | undefined, node: Parser.SyntaxNode) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, text: firstLine(node.text).trim().slice(0, 200) });
  };

  if (lang === 'python') {
    for (const c of root.children) {
      if (c.type === 'function_definition' || c.type === 'class_definition') {
        const name = c.childForFieldName('name')?.text;
        if (name && !name.startsWith('_')) push(name, c);
      }
    }
    return out;
  }
  if (lang === 'go') {
    const walk = (n: Parser.SyntaxNode) => {
      if (n.type === 'function_declaration' || n.type === 'method_declaration' || n.type === 'type_declaration') {
        const name = n.childForFieldName('name')?.text;
        if (name && /^[A-Z]/.test(name)) push(name, n);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }
  if (lang === 'rust') {
    const walk = (n: Parser.SyntaxNode) => {
      if (/_item$/.test(n.type) && n.children.some(c => c.type === 'visibility_modifier')) {
        const name = n.childForFieldName('name')?.text;
        push(name, n);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }
  if (lang === 'java') {
    const walk = (n: Parser.SyntaxNode) => {
      if ((n.type === 'method_declaration' || n.type === 'class_declaration') && /\bpublic\b/.test(firstLine(n.text))) {
        const name = n.childForFieldName('name')?.text;
        push(name, n);
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }
  // js/ts: export_statement subtrees
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'export_statement') {
      // named declarations
      const decl = n.childForFieldName('declaration');
      if (decl) {
        const name = decl.childForFieldName('name')?.text;
        if (name) push(name, decl);
        // multiple declarators (export const a = .., b = ..)
        for (const c of decl.namedChildren) {
          const dn = c.childForFieldName('name')?.text;
          if (dn) push(dn, c);
        }
      }
      // export { a, b }
      for (const spec of n.descendantsOfType('export_specifier')) {
        push(spec.childForFieldName('name')?.text, spec);
      }
      if (n.text.includes('export default')) push('default', n);
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

// ── PageRank over resolved internal graph (real-source nodes) ───────────────
function pageRank(nodes: string[], outEdges: Map<string, Set<string>>, damping = 0.85, iters = 20): Map<string, number> {
  const n = nodes.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const node of nodes) rank.set(node, 1 / n);
  const inEdges = new Map<string, string[]>();
  for (const node of nodes) inEdges.set(node, []);
  const outCount = new Map<string, number>();
  for (const [from, tos] of outEdges) {
    const valid = [...tos].filter(t => rank.has(t));
    outCount.set(from, valid.length);
    for (const to of valid) inEdges.get(to)!.push(from);
  }
  for (let it = 0; it < iters; it++) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const node of nodes) {
      if ((outCount.get(node) || 0) === 0) dangling += rank.get(node)!;
    }
    for (const node of nodes) {
      let sum = 0;
      for (const from of inEdges.get(node)!) {
        sum += rank.get(from)! / (outCount.get(from) || 1);
      }
      next.set(node, (1 - damping) / n + damping * (sum + dangling / n));
    }
    for (const node of nodes) rank.set(node, next.get(node)!);
  }
  // normalize to 0..1 (max = 1)
  let max = 0;
  for (const v of rank.values()) max = Math.max(max, v);
  if (max > 0) for (const node of nodes) rank.set(node, rank.get(node)! / max);
  return rank;
}

// ── Label-propagation community detection (undirected real-source graph) ────
function detectCommunities(nodes: string[], adjacency: Map<string, Set<string>>): Map<string, number> {
  const label = new Map<string, number>();
  nodes.forEach((node, i) => label.set(node, i));
  const order = [...nodes];
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    // shuffle deterministically-ish
    for (const node of order) {
      const neighbors = adjacency.get(node);
      if (!neighbors || neighbors.size === 0) continue;
      const counts = new Map<number, number>();
      for (const nb of neighbors) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) || 0) + 1);
      }
      let best = label.get(node)!, bestCount = -1;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < best)) { best = l; bestCount = c; }
      }
      if (best !== label.get(node)) { label.set(node, best); changed = true; }
    }
    if (!changed) break;
  }
  return label;
}

// ── Stack / entrypoint detection ────────────────────────────────────────────
async function detectStackAndEntrypoints(projectRoot: string, files: string[]): Promise<{ stack: string[]; entrypoints: Set<string> }> {
  const stack = new Set<string>();
  const entrypoints = new Set<string>();
  const rel = (abs: string) => relative(projectRoot, abs);

  // package.json
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      stack.add('Node.js');
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const known of ['react', 'next', 'vue', 'svelte', 'express', 'fastify', 'typescript', 'vite']) {
        if (deps[known]) stack.add(known === 'next' ? 'Next.js' : known[0].toUpperCase() + known.slice(1));
      }
      const addEntry = (p: string | undefined) => {
        if (!p) return;
        const abs = join(projectRoot, p);
        const r = relative(projectRoot, abs);
        if (files.includes(abs)) entrypoints.add(r);
      };
      addEntry(pkg.main);
      if (typeof pkg.bin === 'string') addEntry(pkg.bin);
      else if (pkg.bin) for (const v of Object.values(pkg.bin)) addEntry(v as string);
    } catch { /* ignore */ }
  }

  // python
  const pyproject = join(projectRoot, 'pyproject.toml');
  const setupPy = join(projectRoot, 'setup.py');
  const requirements = join(projectRoot, 'requirements.txt');
  if (existsSync(pyproject) || existsSync(setupPy) || existsSync(requirements)) {
    stack.add('Python');
    let reqText = '';
    for (const f of [pyproject, requirements]) {
      if (existsSync(f)) { try { reqText += await readFile(f, 'utf8'); } catch { /* */ } }
    }
    for (const known of ['pygame', 'PySide6', 'PyQt5', 'PyQt6', 'flask', 'django', 'fastapi', 'numpy', 'pandas', 'torch', 'tensorflow']) {
      if (new RegExp(known, 'i').test(reqText)) stack.add(known);
    }
  }
  if (existsSync(join(projectRoot, 'go.mod'))) stack.add('Go');
  if (existsSync(join(projectRoot, 'Cargo.toml'))) stack.add('Rust');
  if (existsSync(join(projectRoot, 'pom.xml')) || existsSync(join(projectRoot, 'build.gradle'))) stack.add('Java');

  // filename-based entrypoints
  for (const abs of files) {
    const r = rel(abs);
    const base = basename(r);
    if (base === 'main.py' || base === '__main__.py') entrypoints.add(r);
    if (/^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base) && dirname(r).split(sep).length <= 2) entrypoints.add(r);
    if (base === 'main.go' && r.includes('cmd' + sep)) entrypoints.add(r);
    if (base === 'main.go' && !r.includes(sep)) entrypoints.add(r);
    if (base === 'main.rs' || base === 'lib.rs') entrypoints.add(r);
  }

  return { stack: [...stack], entrypoints };
}

// ── Heat composition ─────────────────────────────────────────────────────────
const SMELL_WEIGHT: Record<SmellKind, number> = {
  'todo': 3, 'suppression': 5, 'swallowed-catch': 10,
  'deep-nesting': 6, 'long-function': 5, 'magic-number': 3, 'god-file': 14,
};

function computeHeat(smells: SmellHit[]): number {
  let sum = 0;
  for (const s of smells) sum += s.severity * SMELL_WEIGHT[s.kind];
  return Math.min(100, sum);
}

// ── Public result types ──────────────────────────────────────────────────────
export interface ScanResult {
  projectRoot: string;
  totalFilesScanned: number;
  realSourceCount: number;
  files: FileAnalysis[];        // real-source, ranked by gravity
  map: ProjectMap;
  wildCandidates: FileAnalysis[];
  uiUrl: string;
  graph: ImportGraph;
}

// ── Main scan pipeline ───────────────────────────────────────────────────────
export async function scanProject(projectRoot: string): Promise<ScanResult> {
  await initParser();

  const abs: string[] = [];
  await collectFiles(projectRoot, projectRoot, abs);

  const fileSet = new Set(abs.map(f => relative(projectRoot, f)));
  const basenameIndex = new Map<string, string[]>();
  for (const rel of fileSet) {
    const b = basename(rel).slice(0, basename(rel).length - extname(rel).length);
    if (!basenameIndex.has(b)) basenameIndex.set(b, []);
    basenameIndex.get(b)!.push(rel);
  }

  const { stack, entrypoints } = await detectStackAndEntrypoints(projectRoot, abs);

  // Pass 1: parse + AST analysis + import extraction
  interface Work {
    abs: string; rel: string; lang: Language; source: string;
    ast: AstAnalysis; importSpecs: string[]; pathDemote: string | null;
  }
  const work: Work[] = [];
  const graph: ImportGraph = { nodes: {}, edges: [] };

  for (const file of abs) {
    const rel = relative(projectRoot, file);
    const ext = extname(file);
    const lang = EXT_LANG[ext];
    if (!lang) continue;
    let source: string;
    try { source = await readFile(file, 'utf8'); } catch { continue; }
    // Runtime entrypoint heuristics: __main__ guard or shebang.
    if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(source) || /^#![^\n]*\b(node|python\d?)\b/.test(source)) {
      entrypoints.add(rel);
    }
    const tree = await parseAs(lang, source);
    if (!tree) continue;
    const ast = analyzeAst(source, lang, tree);
    const importSpecs = extractImports(source, lang);
    graph.nodes[rel] = { imports: importSpecs };
    work.push({ abs: file, rel, lang, source, ast, importSpecs, pathDemote: pathDemoteReason(rel) });
  }

  // Pass 2: resolve imports → internal edges; build importedBy / imports
  const importedBy = new Map<string, Set<string>>();
  const importsResolved = new Map<string, Set<string>>();
  const fanOut = new Map<string, number>();
  for (const w of work) { importedBy.set(w.rel, new Set()); importsResolved.set(w.rel, new Set()); }

  for (const w of work) {
    const distinctModules = new Set<string>();
    for (const spec of w.importSpecs) {
      distinctModules.add(spec);
      const target = resolveImport(spec, w.abs, w.lang, projectRoot, fileSet, basenameIndex);
      if (target && target !== w.rel && importedBy.has(target)) {
        importedBy.get(target)!.add(w.rel);
        importsResolved.get(w.rel)!.add(target);
        graph.edges.push({ from: w.rel, to: target });
      }
    }
    fanOut.set(w.rel, distinctModules.size);
  }

  // Determine real-source: path demotions first
  const isRealSource = new Map<string, boolean>();
  const demoteReason = new Map<string, string | null>();
  for (const w of work) {
    if (w.pathDemote) { isRealSource.set(w.rel, false); demoteReason.set(w.rel, w.pathDemote); }
    else { isRealSource.set(w.rel, true); demoteReason.set(w.rel, null); }
  }
  // zero-inbound-from-real-source AND not entrypoint ⇒ demote
  for (const w of work) {
    if (!isRealSource.get(w.rel)) continue;
    if (entrypoints.has(w.rel)) continue;
    const inbound = [...importedBy.get(w.rel)!].filter(src => isRealSource.get(src));
    if (inbound.length === 0) {
      isRealSource.set(w.rel, false);
      demoteReason.set(w.rel, 'no inbound references from application code');
    }
  }

  // PageRank over real-source nodes
  const realNodes = work.filter(w => isRealSource.get(w.rel)).map(w => w.rel);
  const realSet = new Set(realNodes);
  const outEdges = new Map<string, Set<string>>();
  const undirected = new Map<string, Set<string>>();
  for (const node of realNodes) { outEdges.set(node, new Set()); undirected.set(node, new Set()); }
  for (const w of work) {
    if (!realSet.has(w.rel)) continue;
    for (const target of importsResolved.get(w.rel)!) {
      if (!realSet.has(target)) continue;
      outEdges.get(w.rel)!.add(target);
      undirected.get(w.rel)!.add(target);
      undirected.get(target)!.add(w.rel);
    }
  }
  const ranks = pageRank(realNodes, outEdges);
  const communities = detectCommunities(realNodes, undirected);

  // Build FileAnalysis for every file
  const analyses: FileAnalysis[] = [];
  const persisted: Record<string, PersistedFile> = {};
  for (const w of work) {
    const real = isRealSource.get(w.rel)!;
    const fanIn = [...importedBy.get(w.rel)!].filter(src => isRealSource.get(src)).length;
    const centrality = real ? (ranks.get(w.rel) || 0) : 0;
    const gravitySignals: GravitySignals = {
      fanIn, fanOut: fanOut.get(w.rel) || 0, centrality,
      cyclomatic: w.ast.cyclomatic, publicSurface: w.ast.publicSurface, loc: w.ast.loc,
    };
    // Depth factor: ratio of internal complexity to surface area.
    // High for files with gnarly internals; low for barrel re-exports and thin wrappers.
    const depthRatio = (w.ast.cyclomatic + w.ast.maxNesting * 2) / Math.max(1, w.ast.publicSurface);
    const depthFactor = Math.min(1.0, Math.log2(depthRatio + 1) / 3);
    // Penalize centrality for shallow files — a barrel index.ts with 50 re-exports
    // shouldn't dominate the gravity chart.
    const adjustedCentrality = centrality * (0.3 + 0.7 * depthFactor);

    let gravityRaw = adjustedCentrality * 50
      + Math.log2(fanIn + 1) * 6           // reduced from 8 — less weight on raw import count
      + Math.log2(w.ast.cyclomatic + 1) * 7 // increased from 4 — reward complex domain logic
      + Math.log2(w.ast.publicSurface + 1) * 2  // reduced from 3
      + (w.ast.maxNesting >= 4 ? 5 : 0);    // bonus for deeply nested control flow
    if (!real) gravityRaw *= 0.2;
    const gravity = Math.max(0, Math.min(100, gravityRaw));

    const heatSignals: HeatSignals = {
      todos: w.ast.smells.filter(s => s.kind === 'todo').length,
      suppressions: w.ast.smells.filter(s => s.kind === 'suppression').length,
      swallowedCatches: w.ast.swallowedCatches,
      maxNesting: w.ast.maxNesting,
      longFunctions: w.ast.longFunctions,
      magicNumbers: w.ast.magicNumbers,
    };
    const heat = real ? computeHeat(w.ast.smells) : 0;

    // Level 0: keyword match > path match > community detection fallback
    const keywordPillar = matchPillarByImports(w.importSpecs);
    const pathPillar = matchPillarByPath(w.rel);
    const pillarHint = real ? (keywordPillar || pathPillar || `community-${communities.get(w.rel)}`) : null;

    const fa: FileAnalysis = {
      path: w.abs, relativePath: w.rel, language: w.lang,
      isRealSource: real, demoteReason: demoteReason.get(w.rel) || null,
      gravity, heat, gravitySignals, heatSignals, smells: w.ast.smells, pillarHint,
    };
    analyses.push(fa);
    persisted[w.rel] = {
      relativePath: w.rel, language: w.lang, isRealSource: real,
      demoteReason: demoteReason.get(w.rel) || null, gravity, heat,
      gravitySignals, heatSignals, smells: w.ast.smells, pillarHint,
      importedBy: [...importedBy.get(w.rel)!].filter(src => isRealSource.get(src)),
      imports: [...importsResolved.get(w.rel)!],
    };
  }

  const realAnalyses = analyses.filter(a => a.isRealSource).sort((a, b) => b.gravity - a.gravity);

  // Wild candidates: heat >= 60 OR any severity>=4 smell
  const wildCandidates = realAnalyses
    .filter(a => a.heat >= 60 || a.smells.some(s => s.severity >= 4))
    .sort((a, b) => b.heat - a.heat);

  // Pillars from communities
  const pillars = buildPillars(realAnalyses, communities, stack);

  const topGravity = realAnalyses.slice(0, 12).map(a => a.relativePath);
  const topHeat = wildCandidates.slice(0, 12).map(a => a.relativePath);

  const map: ProjectMap = {
    stack, entrypoints: [...entrypoints], pillars,
    fileCount: work.length, realSourceCount: realAnalyses.length,
    topGravity, topHeat, brief: null,
  };

  await writeGraph(projectRoot, graph);
  await writeAnalysis(projectRoot, { files: persisted });

  const uiUrl = `file://${join(projectRoot, '.vibe-splainer', 'ui', 'index.html')}`;
  return {
    projectRoot, totalFilesScanned: work.length, realSourceCount: realAnalyses.length,
    files: realAnalyses, map, wildCandidates, uiUrl, graph,
  };
}

function buildPillars(real: FileAnalysis[], communities: Map<string, number>, _stack: string[]): PillarDef[] {
  // ── Phase 1: Group files with Level 0 keyword/path hints into named pillars ──
  const keywordGroups = new Map<string, FileAnalysis[]>();
  const unlabeled: FileAnalysis[] = [];

  for (const a of real) {
    if (a.pillarHint && !a.pillarHint.startsWith('community-')) {
      // File has a keyword or path-based pillar match
      if (!keywordGroups.has(a.pillarHint)) keywordGroups.set(a.pillarHint, []);
      keywordGroups.get(a.pillarHint)!.push(a);
    } else {
      unlabeled.push(a);
    }
  }

  // Build keyword pillars (only if ≥1 file — even a single file with a keyword match is meaningful)
  const pillars: PillarDef[] = [];
  for (const [name, files] of keywordGroups) {
    const sorted = [...files].sort((a, b) => b.gravity - a.gravity);
    pillars.push({
      name,
      description: `${name} subsystem: ${files.length} file${files.length > 1 ? 's' : ''} centered on ${basename(sorted[0].relativePath)}.`,
      memberFiles: sorted.map(f => f.relativePath),
    });
  }

  // ── Phase 2: Group remaining unlabeled files by community detection ──
  if (unlabeled.length > 0) {
    const communityGroups = new Map<number, FileAnalysis[]>();
    for (const a of unlabeled) {
      const c = communities.get(a.relativePath);
      if (c === undefined) continue;
      if (!communityGroups.has(c)) communityGroups.set(c, []);
      communityGroups.get(c)!.push(a);
    }

    // Sort by aggregate gravity, keep clusters ≥2 files, cap remaining slots
    const remainingSlots = Math.max(0, 6 - pillars.length);
    const sorted = [...communityGroups.entries()]
      .map(([id, files]) => ({ id, files, weight: files.reduce((s, f) => s + f.gravity, 0) }))
      .filter(g => g.files.length >= 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, remainingSlots);

    for (const g of sorted) {
      const top = [...g.files].sort((a, b) => b.gravity - a.gravity);
      const name = pillarNameFromCluster(top);

      // If this cluster's best name matches an existing keyword pillar, merge into it
      const existing = pillars.find(p => p.name === name);
      if (existing) {
        existing.memberFiles.push(...top.map(f => f.relativePath));
        existing.description = `${name} subsystem: ${existing.memberFiles.length} files centered on ${basename(existing.memberFiles[0])}.`;
      } else {
        pillars.push({
          name,
          description: `${g.files.length} files centered on ${basename(top[0].relativePath)}.`,
          memberFiles: top.map(f => f.relativePath),
        });
      }
    }
  }

  // Sort pillars by aggregate gravity of member files
  pillars.sort((a, b) => {
    const gravA = real.filter(f => a.memberFiles.includes(f.relativePath)).reduce((s, f) => s + f.gravity, 0);
    const gravB = real.filter(f => b.memberFiles.includes(f.relativePath)).reduce((s, f) => s + f.gravity, 0);
    return gravB - gravA;
  });

  // Ensure unique names
  const seen = new Set<string>();
  for (const p of pillars) {
    let n = p.name, i = 2;
    while (seen.has(n)) { n = `${p.name} ${i++}`; }
    p.name = n; seen.add(n);
  }

  // Fallback: if no pillars at all, create a single "Core" pillar
  if (pillars.length === 0 && real.length > 0) {
    pillars.push({ name: 'Core', description: 'Primary application code.', memberFiles: real.slice(0, 20).map(f => f.relativePath) });
  }

  return pillars;
}

// Derive a pillar name from a community-detected cluster of files.
// Skips meaningless directory segments (src, lib, app, etc.) and picks
// the most semantically informative segment.
function pillarNameFromCluster(files: FileAnalysis[]): string {
  // Check if most files in the cluster share a keyword/path hint
  const hintCounts = new Map<string, number>();
  for (const f of files) {
    if (f.pillarHint && !f.pillarHint.startsWith('community-')) {
      hintCounts.set(f.pillarHint, (hintCounts.get(f.pillarHint) || 0) + 1);
    }
  }
  if (hintCounts.size > 0) {
    const best = [...hintCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best[1] >= files.length * 0.4) return best[0]; // 40%+ consensus
  }

  // Fall back to directory-based naming, but skip meaningless segments
  const dirs = files.map(f => dirname(f.relativePath)).filter(d => d && d !== '.');
  if (dirs.length) {
    const segCounts = new Map<string, number>();
    for (const d of dirs) {
      const segments = d.split(sep).filter(s => !MEANINGLESS_SEGMENTS.has(s.toLowerCase()));
      const meaningful = segments.pop(); // deepest meaningful segment
      if (meaningful) segCounts.set(meaningful, (segCounts.get(meaningful) || 0) + 1);
    }
    const top = [...segCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) return titleCase(top[0]);
  }

  // Ultimate fallback: name after the highest-gravity file
  const topFile = basename(files[0].relativePath, extname(files[0].relativePath));
  return titleCase(topFile);
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Per-file evidence extraction for get_file_context (Phase 3) ─────────────
export interface FileEvidence {
  language: Language;
  signature: string;
  hotSpans: { startLine: number; endLine: number; snippet: string; reason: string }[];
  smellSpans: { startLine: number; endLine: number; snippet: string; reason: string }[];
  heatSignals: HeatSignals;
  loc: number;
  cyclomatic: number;
}

export async function getFileAnalysis(absPath: string): Promise<FileEvidence | null> {
  const ext = extname(absPath);
  const lang = EXT_LANG[ext];
  if (!lang) return null;
  let source: string;
  try { source = await readFile(absPath, 'utf8'); } catch { return null; }
  const tree = await parseAs(lang, source);
  if (!tree) return null;
  const ast = analyzeAst(source, lang, tree);
  const lines = source.split('\n');

  const smellSpans = ast.smells.map(s => {
    const start = Math.max(0, s.line - 1 - 3);
    const end = Math.min(lines.length, s.endLine + 3);
    return {
      startLine: start + 1, endLine: end,
      snippet: lines.slice(start, end).join('\n').slice(0, 1200),
      reason: `${s.kind}: ${s.note}`,
    };
  });

  const heatSignals: HeatSignals = {
    todos: ast.smells.filter(s => s.kind === 'todo').length,
    suppressions: ast.smells.filter(s => s.kind === 'suppression').length,
    swallowedCatches: ast.swallowedCatches,
    maxNesting: ast.maxNesting,
    longFunctions: ast.longFunctions,
    magicNumbers: ast.magicNumbers,
  };

  return {
    language: lang, signature: ast.signature, hotSpans: ast.hotSpans, smellSpans,
    heatSignals, loc: ast.loc, cyclomatic: ast.cyclomatic,
  };
}
