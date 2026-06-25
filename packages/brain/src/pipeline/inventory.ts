import Parser from 'web-tree-sitter';
import { join, dirname, relative, extname, basename, sep } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import type {
  Language, GravitySignals, HeatSignals, SmellHit, SmellKind,
  FrameworkRole, ProductDomain, SideEffect,
} from '../signals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Parser init ──────────────────────────────────────────────────────────────

let _parser: Parser | null = null;
let _parserCurrentLang: Language | null = null;
const langCache = new Map<Language, Parser.Language>();

export const EXT_LANG: Record<string, Language> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'tsx',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
};

const LANG_WASM: Record<Language, string> = {
  typescript: 'tree-sitter-typescript.wasm', tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm', python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm', rust: 'tree-sitter-rust.wasm', java: 'tree-sitter-java.wasm',
};

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_LANG));

function resolveWasm(file: string): string | null {
  try {
    const wasmsDir = dirname(require.resolve('tree-sitter-wasms/package.json'));
    const p = join(wasmsDir, 'out', file);
    if (existsSync(p)) return p;
  } catch { /* fall through */ }
  const local = join(__dirname, '../../wasm', file);
  return existsSync(local) ? local : null;
}

async function getLanguage(lang: Language): Promise<Parser.Language | null> {
  const cached = langCache.get(lang);
  if (cached) return cached;
  const wasm = resolveWasm(LANG_WASM[lang]);
  if (!wasm) {
    console.error(`[vibesplain] grammar missing for ${lang} (${LANG_WASM[lang]}); skipping`);
    return null;
  }
  try {
    const loaded = await Parser.Language.load(wasm);
    langCache.set(lang, loaded);
    return loaded;
  } catch (err) {
    console.error(`[vibesplain] failed to load grammar for ${lang}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function initParser(): Promise<Parser> {
  if (_parser) return _parser;
  await Parser.init();
  _parser = new Parser();
  const ts = await getLanguage('typescript');
  if (ts) _parser.setLanguage(ts);
  return _parser;
}

export async function parseAs(lang: Language, source: string): Promise<Parser.Tree | null> {
  const p = await initParser();
  if (_parserCurrentLang !== lang) {
    const language = await getLanguage(lang);
    if (!language) return null;
    p.setLanguage(language);
    _parserCurrentLang = lang;
  }
  try {
    return p.parse(source);
  } catch {
    return null;
  }
}

// ── File collection ──────────────────────────────────────────────────────────

export const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', 'out', '.vibesplain', '.git',
  '.venv', 'venv', 'env', '__pycache__', '.idea', '.vscode', '.cache',
  'site-packages', 'target', '.tox', '.mypy_cache', '.pytest_cache',
]);
const EXCLUDE_FILE_PATTERNS = [/\.lock$/, /\.min\.[a-z]+$/, /\.d\.ts$/];

const DEMOTE_SEGMENTS = new Set([
  'docs', 'doc', 'examples', 'example', 'samples', 'sample',
  'mockup', 'mockups', 'fixtures', 'fixture', '__generated__', '__mocks__',
  'playwright', 'e2e', '__tests__', 'cypress', 'storybook', 'stories', '.storybook',
]);
const VENDOR_SEGMENTS = new Set([
  'node_modules', 'vendor', 'vendored', 'site-packages', 'third_party', 'third-party',
]);

export async function collectFiles(dir: string, projectRoot: string, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
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

export function pathDemoteReason(relPath: string): string | null {
  const segs = relPath.split(sep);
  for (const s of segs) {
    if (VENDOR_SEGMENTS.has(s)) return `vendored code (${s})`;
    if (s.endsWith('.venv') || s === 'venv' || s === 'env') return 'virtual environment';
  }
  for (const s of segs) {
    if (DEMOTE_SEGMENTS.has(s.toLowerCase())) return `non-application path segment (${s})`;
  }
  const b = basename(relPath);
  if (/\.min\./.test(b)) return 'minified bundle';
  if (/\.generated\./.test(b)) return 'generated file';
  return null;
}

// ── Framework role inference (stage 2) ──────────────────────────────────────

export function inferFrameworkRole(relPath: string): FrameworkRole {
  const p = relPath.replace(/\\/g, '/');

  if (/\.test\.|\.spec\./.test(p)) return 'test';
  if (/\.generated\.|__generated__|\.prisma\//.test(p)) return 'generated';

  if (/(?:^|\/)app\/.*\/page\.tsx?$/.test(p)) return 'app_route_page';
  if (/(?:^|\/)app\/.*\/layout\.tsx?$/.test(p)) return 'app_route_layout';
  if (/(?:^|\/)app\/.*\/route\.tsx?$/.test(p)) return 'app_route_handler';
  if (/(?:^|\/)app\/.*\/loading\.tsx?$/.test(p)) return 'app_loading_boundary';
  if (/(?:^|\/)app\/.*\/error\.tsx?$/.test(p)) return 'app_error_boundary';

  if (/(?:^|\/)pages\/api\/trpc\//.test(p)) return 'trpc_api_route';
  if (/(?:^|\/)pages\/api\//.test(p)) return 'pages_api_route';
  if (/(?:^|\/)pages\//.test(p)) return 'pages_route';

  if (/\/hooks\/|\/use[A-Z][^/]*\.(ts|tsx)$/.test(p)) return 'hook';
  if (/\/stores?\/|[Ss]tore\.(ts|tsx)$/.test(p)) return 'store';
  if (/[Pp]rovider\.(tsx?|jsx?)$|\/providers?\//.test(p)) return 'provider';
  if (/\.types\.ts$|\/types\.ts$|\/types\/[^/]+\.ts$/.test(p)) return 'type_definition';
  if (/\.(tsx|jsx)$/.test(p)) return 'component';
  if (/\.(ts|js|mjs|cjs)$/.test(p)) return 'utility';
  return 'unknown';
}

// ── Product domain inference (stage 3) ──────────────────────────────────────

export function inferProductDomain(relPath: string, importSpecs: string[]): ProductDomain {
  const p = relPath.toLowerCase().replace(/\\/g, '/');

  if (/\.test\.|\.spec\.|__tests__|\/e2e\/|\/playwright\/|\/cypress\//.test(p)) {
    return 'test_infrastructure';
  }
  if (/\.generated\.|__generated__|\.prisma\//.test(p)) {
    return 'generated_noise';
  }

  if (
    p.includes('oauth') || p.includes('nextauth') ||
    p.includes('/auth/oauth') || p.includes('/api/auth/') ||
    importSpecs.some(s => s.includes('arctic') || s.includes('@auth/core'))
  ) return 'auth_oauth';

  if (
    p.includes('/auth/') || p.includes('signup') || p.includes('login') ||
    p.includes('forgot-password') || p.includes('reset-password') ||
    p.includes('two-factor') || p.includes('verify-email') ||
    importSpecs.some(s => s.includes('next-auth') || s.includes('@clerk/'))
  ) return 'auth';

  if (
    (p.includes('stripe') || p.includes('paypal') || p.includes('btcpay') ||
     p.includes('alby') || p.includes('payment')) &&
    (p.includes('webhook') || p.includes('hook'))
  ) return 'payments_webhooks';

  if (
    p.includes('stripe') || p.includes('paypal') || p.includes('btcpay') ||
    p.includes('alby') || p.includes('payment') || p.includes('billing') ||
    p.includes('checkout') || p.includes('subscription') ||
    importSpecs.some(s => s.includes('stripe') || s.includes('@stripe/'))
  ) return 'payments';

  if (p.includes('webhook')) return 'webhooks';

  // Generic routing detection (Next.js/React Router concepts)
  if (
    (p.includes('middleware') && !p.includes('pages/api/')) ||
    p.includes('/router.') || p.includes('routerconfig')
  ) return 'routing_infrastructure';

  return 'unknown';
}

// ── Pillar matching ───────────────────────────────────────────────────────────

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
  'Queue':    ['bull', 'bullmq', 'amqplib', 'kafkajs', 'kafka',
               'upstash', '@upstash/', 'bee-queue', 'agenda'],
  'Storage':  ['aws-sdk', '@aws-sdk/', 'multer', 'cloudinary',
               '@google-cloud/storage', 'minio', '@vercel/blob', 'sharp', 'imagekit'],
  'Config':   ['dotenv', 'convict', 'env-var', '@t3-oss/env', 'envalid'],
  'Email':    ['nodemailer', 'resend', '@sendgrid/', 'postmark', '@resend/', 'mailgun'],
  'Realtime': ['socket.io', 'ws', 'pusher', 'ably', '@supabase/realtime', 'socket.io-client'],
};

const PILLAR_PATH_PATTERNS: Record<string, RegExp> = {
  'Auth':     /(?:^|[\/\\])(?:auth|login|signup|register|session|oauth)(?:[\/\\]|$)/i,
  'Database': /(?:^|[\/\\])(?:db|database|models?|schema|migrations?|seeds?)(?:[\/\\]|$)/i,
  'Payments': /(?:^|[\/\\])(?:pay|payments?|billing|checkout|subscriptions?|stripe)(?:[\/\\]|$)/i,
  'Queue':    /(?:^|[\/\\])(?:queues?|workers?|jobs?|consumers?|producers?)(?:[\/\\]|$)/i,
  'Storage':  /(?:^|[\/\\])(?:storage|uploads?|s3|blobs?|media)(?:[\/\\]|$)/i,
  'Config':   /(?:^|[\/\\])(?:config|env|settings?)(?:[\/\\]|$)/i,
  'Email':    /(?:^|[\/\\])(?:emails?|mail|notifications?)(?:[\/\\]|$)/i,
};

export const MEANINGLESS_SEGMENTS = new Set([
  'src', 'lib', 'app', 'pages', 'components', 'modules', 'features',
  'core', 'common', 'shared', 'internal', 'pkg', 'packages',
]);

export function matchPillarByImports(importSpecs: string[]): string | null {
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

export function matchPillarByPath(relPath: string): string | null {
  for (const [pillar, pattern] of Object.entries(PILLAR_PATH_PATTERNS)) {
    if (pattern.test(relPath)) return pillar;
  }
  return null;
}

// ── Import extraction ────────────────────────────────────────────────────────

export function extractImports(source: string, lang: Language): string[] {
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
  const re = /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) specs.push(m[1] || m[2]);
  return specs;
}

export interface RawNamedImport {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
  importKind: 'named' | 'default' | 'namespace' | 'side_effect';
  isTypeOnly: boolean;
  sourceLine: number;
  rawText: string;
}

export function extractNamedImports(
  source: string,
  lang: Language,
  tree: Parser.Tree,
): RawNamedImport[] {
  const imports: RawNamedImport[] = [];
  if (lang !== 'typescript' && lang !== 'tsx' && lang !== 'javascript') {
    return imports;
  }

  const walk = (node: Parser.SyntaxNode) => {
    if (node.type === 'import_statement') {
      const moduleSpecifierNode = node.childForFieldName('source');
      if (!moduleSpecifierNode) return;
      const moduleSpecifier = moduleSpecifierNode.text.replace(/['"]/g, '');

      const importKeyword = node.children.find(c => c.type === 'import');
      let isGlobalTypeOnly = false;
      if (importKeyword) {
        const nextNode = importKeyword.nextSibling;
        if (nextNode && nextNode.type === 'type') {
          isGlobalTypeOnly = true;
        }
      }

      const importClause = node.children.find(c => c.type === 'import_clause');
      if (!importClause) {
        imports.push({
          localName: '',
          importedName: '',
          moduleSpecifier,
          importKind: 'side_effect',
          isTypeOnly: isGlobalTypeOnly,
          sourceLine: node.startPosition.row + 1,
          rawText: firstLine(node.text)
        });
        return;
      }

      const defaultIdentifier = importClause.children.find(c => c.type === 'identifier');
      if (defaultIdentifier) {
        imports.push({
          localName: defaultIdentifier.text,
          importedName: 'default',
          moduleSpecifier,
          importKind: 'default',
          isTypeOnly: isGlobalTypeOnly,
          sourceLine: node.startPosition.row + 1,
          rawText: firstLine(node.text)
        });
      }

      const namespaceImport = importClause.children.find(c => c.type === 'namespace_import');
      if (namespaceImport) {
        const identifier = namespaceImport.children.find(c => c.type === 'identifier');
        if (identifier) {
          imports.push({
            localName: identifier.text,
            importedName: '*',
            moduleSpecifier,
            importKind: 'namespace',
            isTypeOnly: isGlobalTypeOnly,
            sourceLine: node.startPosition.row + 1,
            rawText: firstLine(node.text)
          });
        }
      }

      const namedImports = importClause.children.find(c => c.type === 'named_imports');
      if (namedImports) {
        for (const specifier of namedImports.children.filter(c => c.type === 'import_specifier')) {
          const isTypeKeyword = specifier.children.some(c => c.type === 'type');
          const isSpecifierTypeOnly = isGlobalTypeOnly || isTypeKeyword;

          const nameNode = specifier.childForFieldName('name');
          const aliasNode = specifier.childForFieldName('alias');

          if (nameNode) {
            imports.push({
              localName: aliasNode ? aliasNode.text : nameNode.text,
              importedName: nameNode.text,
              moduleSpecifier,
              importKind: 'named',
              isTypeOnly: isSpecifierTypeOnly,
              sourceLine: node.startPosition.row + 1,
              rawText: firstLine(node.text)
            });
          }
        }
      }
    } else if (node.type === 'variable_declarator') {
      const init = node.childForFieldName('value');
      if (init && init.type === 'call_expression') {
        const fnNameNode = init.childForFieldName('function');
        if (fnNameNode && fnNameNode.text === 'require') {
          const args = init.childForFieldName('arguments');
          if (args && args.namedChildCount > 0) {
            const specNode = args.namedChildren[0];
            if (specNode.type === 'string') {
              const specifier = specNode.text.replace(/['"]/g, '');
              const idNode = node.childForFieldName('name');
              if (idNode) {
                if (idNode.type === 'identifier') {
                  imports.push({
                    localName: idNode.text,
                    importedName: 'default',
                    moduleSpecifier: specifier,
                    importKind: 'default',
                    isTypeOnly: false,
                    sourceLine: node.startPosition.row + 1,
                    rawText: firstLine(node.text)
                  });
                } else if (idNode.type === 'object_pattern') {
                  // TODO: handle require destructuring
                }
              }
            }
          }
        }
      }
    }

    for (const child of node.children) {
      walk(child);
    }
  };

  walk(tree.rootNode);
  return imports;
}

// ── Stack / entrypoint detection ─────────────────────────────────────────────

export async function detectStackAndEntrypoints(
  projectRoot: string,
  files: string[],
): Promise<{ stack: string[]; entrypoints: Set<string> }> {
  const stack = new Set<string>();
  const entrypoints = new Set<string>();
  const rel = (abs: string) => relative(projectRoot, abs);

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

  for (const abs of files) {
    const r = rel(abs);
    const b = basename(r);
    if (b === 'main.py' || b === '__main__.py') entrypoints.add(r);
    if (/^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(b) && dirname(r).split(sep).length <= 2) entrypoints.add(r);
    if (b === 'main.go' && r.includes('cmd' + sep)) entrypoints.add(r);
    if (b === 'main.go' && !r.includes(sep)) entrypoints.add(r);
    if (b === 'main.rs' || b === 'lib.rs') entrypoints.add(r);
  }

  if (stack.has('Next.js')) {
    const appRouterNames = new Set(['page', 'layout', 'route', 'loading', 'error', 'not-found', 'template', 'default']);
    for (const abs of files) {
      const r = rel(abs);
      const stem = basename(r, extname(r));
      if (/(?:^|[/\\])app[/\\]/.test(r) && appRouterNames.has(stem)) entrypoints.add(r);
      if (/(?:^|[/\\])pages[/\\]/.test(r) && !stem.startsWith('_')) entrypoints.add(r);
    }
  }

  return { stack: [...stack], entrypoints };
}

// ── AST analysis ─────────────────────────────────────────────────────────────

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

export interface AstAnalysis {
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
  hotSpans: { startLine: number; endLine: number; rawExcerpt: string; snippet: string; reason: string }[];
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
    if (n.type === 'boolean_operator') count++;
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
      i++; continue;
    }
    if (t === '') { i++; continue; }
    if (t.startsWith('//') || t.startsWith('#')) { i++; continue; }
    if (t.startsWith('/*')) {
      inBlock = !t.includes('*/');
      i++; continue;
    }
    if (t.startsWith('"""') || t.startsWith("'''")) {
      const q = t.slice(0, 3);
      if (t.length > 3 && t.endsWith(q)) { i++; continue; }
      i++;
      while (i < lines.length && !lines[i].includes(q)) i++;
      i++; continue;
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

function catchIsSwallowed(node: Parser.SyntaxNode): boolean {
  const bodyText = node.text;
  const inner = bodyText.replace(/^[^{:]*[{:]/, '');
  const meaningful = inner.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('#') && l !== '}' && l !== 'pass');
  if (meaningful.length === 0) return true;
  return meaningful.every(l =>
    /^(console\.(log|error|warn|info)|print|println!?|System\.out|logger?\.)/.test(l) ||
    l === 'pass' || l === '{' || l === '});' || l === ')' || l === '`'
  );
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
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'export_statement') {
      const decl = n.childForFieldName('declaration');
      if (decl) {
        const name = decl.childForFieldName('name')?.text;
        if (name) push(name, decl);
        for (const c of decl.namedChildren) {
          const dn = c.childForFieldName('name')?.text;
          if (dn) push(dn, c);
        }
      }
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

export function analyzeAst(source: string, lang: Language, tree: Parser.Tree): AstAnalysis {
  const root = tree.rootNode;
  const lines = source.split('\n');
  const loc = lines.length;
  const cyclomatic = countDecisions(root);
  const maxNesting = computeNesting(root, 0);

  const smells: SmellHit[] = [];

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

  let magicNumbers = 0;
  const magicWalk = (n: Parser.SyntaxNode) => {
    if (n.type === 'number' || n.type === 'integer_literal' || n.type === 'float_literal' || n.type === 'int_literal') {
      const v = n.text.replace(/_/g, '');
      if (!['0', '1', '2', '-1', '100', '1000'].includes(v) && /^\d{2,}$/.test(v)) magicNumbers++;
    }
    for (const c of n.children) magicWalk(c);
  };
  magicWalk(root);
  if (magicNumbers > 6) {
    smells.push({ kind: 'magic-number', line: 1, endLine: 1, text: `${magicNumbers} unexplained numeric literals`, severity: 2, note: 'many magic numbers — extract named constants' });
  }

  let swallowedCatches = 0;
  const catchWalk = (n: Parser.SyntaxNode) => {
    if (CATCH_TYPES.has(n.type) && catchIsSwallowed(n)) {
      swallowedCatches++;
      smells.push({
        kind: 'swallowed-catch', line: n.startPosition.row + 1, endLine: n.endPosition.row + 1,
        text: firstLine(n.text).trim().slice(0, 200), severity: 4, note: 'catch block swallows error silently',
      });
    }
    for (const c of n.children) catchWalk(c);
  };
  catchWalk(root);

  const fnNodes = collectFunctionNodes(root);
  let longFunctions = 0;
  const scored: { node: Parser.SyntaxNode; decisions: number; bodyLOC: number; score: number }[] = [];
  for (const fn of fnNodes) {
    const bodyLOC = nodeLOC(fn);
    const decisions = countDecisions(fn);
    let score = decisions + bodyLOC;

    // Boost webhook handlers & main entrypoint logic
    const text = fn.text;
    if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
      if (/stripe|webhook|payload|signature|event/i.test(text) && /switch|case|if/i.test(text)) {
        score += 25;
      }
      if (text.includes('prisma') && (text.includes('create') || text.includes('update'))) {
        score += 10;
      }
    }

    scored.push({ node: fn, decisions, bodyLOC, score });
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

  scored.sort((a, b) => b.score - a.score);
  const hotSpans = scored.slice(0, 3).filter(s => s.bodyLOC >= 2).map(s => {
    const rawExcerpt = source.split('\n')
      .slice(s.node.startPosition.row, s.node.endPosition.row + 1)
      .join('\n');
    const snippet = stripLeadingComments(rawExcerpt).slice(0, 2000);
    return {
      startLine: s.node.startPosition.row + 1,
      endLine: s.node.endPosition.row + 1,
      rawExcerpt,
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

// ── Heat composition ─────────────────────────────────────────────────────────

const SMELL_WEIGHT: Record<SmellKind, number> = {
  'todo': 3, 'suppression': 5, 'swallowed-catch': 10,
  'deep-nesting': 6, 'long-function': 5, 'magic-number': 3, 'god-file': 14,
};

export function computeHeat(smells: SmellHit[]): number {
  let sum = 0;
  for (const s of smells) sum += s.severity * SMELL_WEIGHT[s.kind];
  return Math.min(100, sum);
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface WorkItem {
  abs: string;
  rel: string;
  lang: Language;
  source: string;
  ast: AstAnalysis;
  importSpecs: string[];
  rawNamedImports: RawNamedImport[];
  pathDemote: string | null;
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
}

export interface InventoryResult {
  projectRoot: string;
  work: WorkItem[];
  stack: string[];
  entrypoints: Set<string>;
  fileSet: Set<string>;
  basenameIndex: Map<string, string[]>;
}

// ── Stage implementation ──────────────────────────────────────────────────────

export async function runInventory(projectRoot: string): Promise<InventoryResult> {
  await initParser();

  // Stage 1: collect files
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

  // Parse each file + extract imports + classify
  const work: WorkItem[] = [];
  for (const file of abs) {
    const rel = relative(projectRoot, file);
    const ext = extname(file);
    const lang = EXT_LANG[ext];
    if (!lang) continue;

    let source: string;
    try { source = await readFile(file, 'utf8'); } catch { continue; }

    if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(source) || /^#![^\n]*\b(node|python\d?)\b/.test(source)) {
      entrypoints.add(rel);
    }

    const tree = await parseAs(lang, source);
    if (!tree) continue;

    const ast = analyzeAst(source, lang, tree);
    const importSpecs = extractImports(source, lang);
    const rawNamedImports = extractNamedImports(source, lang, tree);

    // Stage 2: framework role
    const frameworkRole = inferFrameworkRole(rel);
    // Stage 3: product domain
    const productDomain = inferProductDomain(rel, importSpecs);

    work.push({
      abs: file, rel, lang, source, ast, importSpecs, rawNamedImports,
      pathDemote: pathDemoteReason(rel),
      frameworkRole, productDomain,
    });
  }

  // Write stage artifacts
  const dir = join(projectRoot, '.vibesplain');
  await mkdir(dir, { recursive: true });

  const stage01 = {
    files: work.map(w => ({
      absPath: w.abs, relPath: w.rel,
      language: w.lang, demoteReason: w.pathDemote,
    })),
    totalCount: work.length,
    realSourceCount: work.filter(w => !w.pathDemote).length,
  };
  const stage02 = Object.fromEntries(work.map(w => [w.rel, w.frameworkRole]));
  const stage03 = Object.fromEntries(work.map(w => [w.rel, w.productDomain]));
  await Promise.all([
    writeFile(join(dir, 'stage-01-inventory.json'), JSON.stringify(stage01, null, 2), 'utf8'),
    writeFile(join(dir, 'stage-02-framework-roles.json'), JSON.stringify(stage02, null, 2), 'utf8'),
    writeFile(join(dir, 'stage-03-domains.json'), JSON.stringify(stage03, null, 2), 'utf8'),
  ]);

  return { projectRoot, work, stack, entrypoints, fileSet, basenameIndex };
}
