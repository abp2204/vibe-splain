import Parser from 'web-tree-sitter';
import { join, dirname, relative, extname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { writeGraph, type ImportGraph } from './graph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let parser: Parser | null = null;

export async function initParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  parser = new Parser();

  // Resolve WASM path: try tree-sitter-wasms package first, then local wasm dir
  let wasmPath: string;
  try {
    const wasmsDir = dirname(require.resolve('tree-sitter-wasms/package.json'));
    wasmPath = join(wasmsDir, 'out', 'tree-sitter-typescript.wasm');
    if (!existsSync(wasmPath)) throw new Error('WASM not found in package');
  } catch {
    wasmPath = join(__dirname, '../wasm', 'tree-sitter-typescript.wasm');
  }

  const Lang = await Parser.Language.load(wasmPath);
  parser.setLanguage(Lang);
  return parser;
}

// File exclusion patterns
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.vibe-splainer', '.git']);
const EXCLUDE_PATTERNS = [/\.test\./, /\.spec\./, /\.config\./, /\.lock$/, /\.min\.js$/, /\.d\.ts$/];
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// Level 0 — Pillar detection keywords
const PILLAR_KEYWORDS: Record<string, string[]> = {
  'Auth': ['passport', 'jsonwebtoken', 'bcrypt', 'oauth', 'session', 'cookie-parser'],
  'Database': ['prisma', 'mongoose', 'sequelize', 'typeorm', 'knex', 'pg', 'mysql2'],
  'Payments': ['stripe', 'paypal', 'braintree', 'plaid'],
  'Routing': ['express.Router', 'fastify', 'koa-router', 'next/router'],
  'Queue': ['bull', 'bullmq', 'amqplib', 'kafka', 'redis'],
  'Storage': ['aws-sdk', 's3', 'multer', 'cloudinary', '@google-cloud/storage'],
  'Config': ['dotenv', 'convict', 'zod'],
};

export interface HighGravityFile {
  path: string;
  relativePath: string;
  cognitiveWeight: number;
  linkDensity: number;
  nestingDepth: number;
  mutationCount: number;
  pillars: string[];
}

export interface PillarGroup {
  name: string;
  files: HighGravityFile[];
}

export interface ScanResult {
  projectRoot: string;
  totalFilesScanned: number;
  highGravityFiles: HighGravityFile[];
  pillarGroups: PillarGroup[];
  wildCandidates: HighGravityFile[];
  uiUrl: string;
  graph: ImportGraph;
}

async function collectFiles(dir: string, projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, projectRoot);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const relPath = relative(projectRoot, fullPath);
      if (EXCLUDE_PATTERNS.some(p => p.test(relPath))) continue;
      files.push(fullPath);
    }
  }
  return files;
}

function detectPillars(source: string): string[] {
  const pillars: string[] = [];
  for (const [pillar, keywords] of Object.entries(PILLAR_KEYWORDS)) {
    for (const kw of keywords) {
      if (source.includes(kw)) {
        if (!pillars.includes(pillar)) pillars.push(pillar);
        break;
      }
    }
  }
  return pillars;
}

function computeNestingDepth(node: Parser.SyntaxNode, depth: number = 0): number {
  let maxDepth = depth;
  const nestingTypes = new Set([
    'function_declaration', 'function', 'arrow_function',
    'method_definition', 'class_declaration', 'class',
    'if_statement', 'for_statement', 'for_in_statement',
    'while_statement', 'do_statement', 'switch_statement',
    'try_statement', 'catch_clause'
  ]);
  for (const child of node.children) {
    if (nestingTypes.has(child.type)) {
      const childMax = computeNestingDepth(child, depth + 1);
      maxDepth = Math.max(maxDepth, childMax);
    } else {
      const childMax = computeNestingDepth(child, depth);
      maxDepth = Math.max(maxDepth, childMax);
    }
  }
  return maxDepth;
}

function countMutations(node: Parser.SyntaxNode): number {
  let count = 0;
  if (node.type === 'assignment_expression' || node.type === 'augmented_assignment_expression') {
    // Check if it's NOT a const declaration (const is variable_declaration with const)
    const parent = node.parent;
    if (!parent || parent.type !== 'variable_declarator' || 
        !parent.parent || parent.parent.type !== 'lexical_declaration' ||
        parent.parent.children[0]?.text !== 'const') {
      count++;
    }
  }
  for (const child of node.children) {
    count += countMutations(child);
  }
  return count;
}

function countImports(node: Parser.SyntaxNode): number {
  let count = 0;
  for (const child of node.children) {
    if (child.type === 'import_statement' || child.type === 'import_declaration') {
      count++;
    }
  }
  return count;
}

function extractImportPaths(source: string): string[] {
  const paths: string[] = [];
  // Match both import and require statements
  const importRegex = /(?:import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  const p = await initParser();
  const files = await collectFiles(projectRoot, projectRoot);
  
  // Build import graph
  const graph: ImportGraph = { nodes: {}, edges: [] };
  const fileImportMap = new Map<string, string[]>(); // file -> import paths
  const reverseImportCount = new Map<string, number>(); // file -> times imported by others
  
  // First pass: collect all import paths
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relPath = relative(projectRoot, file);
    const importPaths = extractImportPaths(source);
    fileImportMap.set(file, importPaths);
    graph.nodes[relPath] = { imports: importPaths };
    
    // Count reverse imports (how many times this file is imported by others)
    for (const imp of importPaths) {
      // Resolve relative imports
      if (imp.startsWith('.')) {
        const resolvedDir = dirname(file);
        const resolved = join(resolvedDir, imp);
        // Try common extensions
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
          const candidate = resolved.endsWith(ext) ? resolved : resolved + ext;
          const relCandidate = relative(projectRoot, candidate);
          reverseImportCount.set(relCandidate, (reverseImportCount.get(relCandidate) || 0) + 1);
        }
      }
    }
  }
  
  // Second pass: compute cognitive weight for each file
  const allAnalyzed: HighGravityFile[] = [];
  
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relPath = relative(projectRoot, file);
    
    // Level 0: detect pillars
    const pillars = detectPillars(source);
    
    // Level 1: cognitive weight via Tree-Sitter
    let tree: Parser.Tree;
    try {
      tree = p.parse(source);
    } catch {
      continue; // Skip unparseable files
    }
    
    const importCount = countImports(tree.rootNode);
    const reverseCount = reverseImportCount.get(relPath) || 0;
    const linkDensity = importCount + reverseCount;
    const nestingDepth = computeNestingDepth(tree.rootNode);
    const mutationCount = countMutations(tree.rootNode);
    
    const cognitiveWeight = (linkDensity * 2) + nestingDepth + (mutationCount * 1.5);
    
    // Record import edges
    const importPaths = fileImportMap.get(file) || [];
    for (const imp of importPaths) {
      graph.edges.push({ from: relPath, to: imp });
    }
    
    allAnalyzed.push({
      path: file,
      relativePath: relPath,
      cognitiveWeight,
      linkDensity,
      nestingDepth,
      mutationCount,
      pillars,
    });
  }
  
  // Filter high-gravity files (cognitive weight >= 15)
  const highGravityFiles = allAnalyzed.filter(f => f.cognitiveWeight >= 15)
    .sort((a, b) => b.cognitiveWeight - a.cognitiveWeight);
  
  // Group by pillar (Level 0)
  const pillarMap = new Map<string, HighGravityFile[]>();
  const untaggedFiles: HighGravityFile[] = [];
  
  for (const file of highGravityFiles) {
    if (file.pillars.length > 0) {
      for (const pillar of file.pillars) {
        if (!pillarMap.has(pillar)) pillarMap.set(pillar, []);
        pillarMap.get(pillar)!.push(file);
      }
    } else {
      untaggedFiles.push(file);
    }
  }
  
  // Level 2: group untagged by directory
  const dirGroups = new Map<string, HighGravityFile[]>();
  for (const file of untaggedFiles) {
    const dir = dirname(file.relativePath);
    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    dirGroups.get(dir)!.push(file);
  }
  
  // Merge pillar groups
  const pillarGroups: PillarGroup[] = [];
  for (const [name, files] of pillarMap) {
    pillarGroups.push({ name, files });
  }
  for (const [name, files] of dirGroups) {
    pillarGroups.push({ name, files });
  }
  
  // Wild candidates: cognitive weight >= 25
  const wildCandidates = highGravityFiles.filter(f => f.cognitiveWeight >= 25);
  
  // Save graph
  await writeGraph(projectRoot, graph);
  
  const uiUrl = `file://${join(projectRoot, '.vibe-splainer', 'ui', 'index.html')}`;
  
  return {
    projectRoot,
    totalFilesScanned: files.length,
    highGravityFiles,
    pillarGroups,
    wildCandidates,
    uiUrl,
    graph,
  };
}
