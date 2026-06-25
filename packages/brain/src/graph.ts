import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

export interface ImportEdge {
  from: string;
  to: string;
}

export interface ImportGraph {
  nodes: Record<string, { imports: string[] }>;
  edges: ImportEdge[];
}

export async function readGraph(projectRoot: string): Promise<ImportGraph | null> {
  const graphPath = join(projectRoot, '.vibesplain', 'graph.json');
  try {
    const raw = await readFile(graphPath, 'utf8');
    return JSON.parse(raw) as ImportGraph;
  } catch {
    return null;
  }
}

export async function writeGraph(projectRoot: string, graph: ImportGraph): Promise<void> {
  const dir = join(projectRoot, '.vibesplain');
  await mkdir(dir, { recursive: true });
  const graphPath = join(dir, 'graph.json');
  await writeFile(graphPath, JSON.stringify(graph, null, 2), 'utf8');
}
