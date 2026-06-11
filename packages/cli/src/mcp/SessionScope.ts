import { minimatch } from 'minimatch';
import type { WorkOrderRow, ProofDescriptor } from '../store/PointerStore.js';

export interface ScopePolicy {
  workOrderId: string;
  allowedFiles: string[];
  allowedGlobs: string[];
  deniedGlobs: string[];
  requiredProof: ProofDescriptor[];
}

export class ScopeViolation extends Error {
  constructor(
    public readonly path: string,
    public readonly workOrderId: string,
    reason: string,
  ) {
    super(`ScopeViolation [${workOrderId}]: ${reason} — path: ${path}`);
    this.name = 'ScopeViolation';
  }
}

let activeScope: ScopePolicy | null = null;

export const SessionScope = {
  set(policy: ScopePolicy): void {
    activeScope = policy;
  },

  clear(): void {
    activeScope = null;
  },

  get(): ScopePolicy | null {
    return activeScope;
  },

  /**
   * Enforce scope for a file path.
   * Throws ScopeViolation if:
   *  - a scope is active AND the path is not allowed
   * If no scope is active, all paths are permitted.
   */
  enforce(filePath: string): void {
    if (!activeScope) return;

    const { workOrderId, allowedFiles, allowedGlobs, deniedGlobs } = activeScope;

    // Explicit file list match (exact suffix or relative path)
    const inAllowedFiles = allowedFiles.some(f =>
      filePath === f || filePath.endsWith('/' + f) || filePath.endsWith(f)
    );

    // Glob match
    const inAllowedGlobs = allowedGlobs.some(g => minimatch(filePath, g, { matchBase: true }));

    if (!inAllowedFiles && !inAllowedGlobs) {
      throw new ScopeViolation(filePath, workOrderId, 'path not in allowedFiles or allowedGlobs');
    }

    // Deny globs have priority over allow
    const isDenied = deniedGlobs.some(g => minimatch(filePath, g, { matchBase: true }));
    if (isDenied) {
      throw new ScopeViolation(filePath, workOrderId, 'path matches deniedGlobs');
    }
  },

  fromWorkOrderRow(row: WorkOrderRow): ScopePolicy {
    return {
      workOrderId: row.workOrderId,
      allowedFiles: JSON.parse(row.allowedFiles) as string[],
      allowedGlobs: JSON.parse(row.allowedGlobs) as string[],
      deniedGlobs: JSON.parse(row.deniedGlobs) as string[],
      requiredProof: JSON.parse(row.requiredProof) as ProofDescriptor[],
    };
  },
};
