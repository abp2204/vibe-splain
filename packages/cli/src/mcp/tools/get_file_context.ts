import { readFile } from 'fs/promises';
import { join, relative } from 'path';
import { readGraph } from '@vibe-splain/brain';

export const getFileContextTool = {
  name: 'get_file_context',
  description: 'Returns the full source code of a specific high-gravity file, its cognitive weight breakdown, and its import graph neighbors. Call this for each file you want to synthesize a Decision Card for. Use the source + neighbors to understand what the code does and WHY it was written that way.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: {
        type: 'string',
        description: 'Absolute path to the project root',
      },
      filePath: {
        type: 'string',
        description: 'Relative or absolute path to the file',
      },
    },
    required: ['projectRoot', 'filePath'],
  },
};

export async function handleGetFileContext(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const filePath = args.filePath as string;
  if (!projectRoot || !filePath) throw new Error('projectRoot and filePath are required');

  const fullPath = filePath.startsWith('/') ? filePath : join(projectRoot, filePath);
  const relPath = relative(projectRoot, fullPath);

  const source = await readFile(fullPath, 'utf8');
  const graph = await readGraph(projectRoot);

  // Find neighbors in import graph
  const neighbors: string[] = [];
  if (graph) {
    for (const edge of graph.edges) {
      if (edge.from === relPath) neighbors.push(edge.to);
      if (edge.to === relPath || edge.to.endsWith(relPath)) neighbors.push(edge.from);
    }
  }

  return {
    filePath: relPath,
    source,
    lineCount: source.split('\n').length,
    neighbors: [...new Set(neighbors)],
  };
}
