import { basename } from 'path';

export interface PathMappingRule {
  pattern: string | RegExp;
  replacement: string;
}

/**
 * Maps a file path using a series of replacement rules.
 * Useful for mapping build/dist paths to source packages paths.
 * 
 * @param path The path to map.
 * @param rules Array of replacement rules.
 */
export function mapPath(path: string, rules: PathMappingRule[]): string {
  let current = path;
  for (const rule of rules) {
    current = current.replace(rule.pattern, rule.replacement);
  }
  return current;
}

/**
 * Extracts a canonical name from a path by getting the basename and stripping a list of suffixes.
 * Useful for identifying node or credentials types irrespective of file type or extensions.
 * 
 * @param path The file path or manifest path.
 * @param suffixes Suffixes (string or RegExp) to strip from the end of the basename.
 */
export function getCanonicalName(path: string, suffixes: (string | RegExp)[]): string {
  let base = basename(path);
  for (const suffix of suffixes) {
    base = base.replace(suffix, '');
  }
  return base;
}

export interface ResolveSourceFilesOptions {
  /** The expected primary source path */
  expectedPath?: string;
  /** Explicit alternate filenames (aliases) to search for */
  aliases?: string[];
  /** Pattern for matching versioned files (e.g. IfV2.node.ts) */
  versionPattern?: {
    baseName: string;
    /** The suffix that comes after the version identifier, e.g., ".node.ts" */
    suffix: string;
    /** The version identifier prefix, e.g., "V". Defaults to "V" if not specified. */
    versionPrefix?: string;
  };
  /** Custom filter function to restrict search space (e.g. by folder prefix) */
  filter?: (relPath: string) => boolean;
}

/**
 * Searches a list of project files for those that match the expected path,
 * aliases, or a versioned naming pattern.
 * 
 * @param files The project file list.
 * @param options Resolution criteria.
 */
export function resolveSourceFiles(
  files: readonly { rel: string }[],
  options: ResolveSourceFilesOptions
): string[] {
  const matches: string[] = [];

  // 1. Exact expected path match
  if (options.expectedPath && files.some(f => f.rel === options.expectedPath)) {
    matches.push(options.expectedPath);
  }

  const filter = options.filter ?? (() => true);

  // 2. Alias match
  if (options.aliases) {
    for (const alias of options.aliases) {
      const found = files.find(f => filter(f.rel) && f.rel.endsWith(`/${alias}`));
      if (found && !matches.includes(found.rel)) {
        matches.push(found.rel);
      }
    }
  }

  // 3. Version suffix match: baseName + versionPrefix + (anything) + suffix
  if (options.versionPattern) {
    const { baseName, suffix, versionPrefix = 'V' } = options.versionPattern;
    const escapedBase = escapeRegExp(baseName);
    const escapedPrefix = escapeRegExp(versionPrefix);
    const escapedSuffix = escapeRegExp(suffix);
    // Matches if it starts with baseName + versionPrefix and ends with suffix.
    const versionRegex = new RegExp(`^${escapedBase}${escapedPrefix}.*${escapedSuffix}$`);

    const foundGeneral = files.filter(f => {
      if (!filter(f.rel)) return false;
      return versionRegex.test(basename(f.rel));
    });

    for (const f of foundGeneral) {
      if (!matches.includes(f.rel)) {
        matches.push(f.rel);
      }
    }
  }

  return matches;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CategoryMetrics {
  registered: number;
  resolved: number;
  unresolved: number;
}

/**
 * Helper class to track registration, resolution success, and resolution failure
 * across multiple categories, and compile metrics.
 */
export class ResolutionTracker {
  private stats: Record<string, CategoryMetrics> = {};

  constructor(categories: string[] = []) {
    for (const category of categories) {
      this.ensureCategory(category);
    }
  }

  private ensureCategory(category: string) {
    if (!this.stats[category]) {
      this.stats[category] = { registered: 0, resolved: 0, unresolved: 0 };
    }
  }

  /** Registers manifest item counts for a category */
  register(category: string, count = 1): void {
    this.ensureCategory(category);
    this.stats[category].registered += count;
  }

  /** Increments successful resolution count for a category */
  resolve(category: string, count = 1): void {
    this.ensureCategory(category);
    this.stats[category].resolved += count;
  }

  /** Increments unresolved count for a category */
  unresolve(category: string, count = 1): void {
    this.ensureCategory(category);
    this.stats[category].unresolved += count;
  }

  /** Generates the metrics Record with namespaced keys, e.g. `<prefix>.<category>.registered` */
  getMetrics(prefix: string): Record<string, number> {
    const metrics: Record<string, number> = {};
    for (const [category, stat] of Object.entries(this.stats)) {
      metrics[`${prefix}.${category}.registered`] = stat.registered;
      metrics[`${prefix}.${category}.resolved`] = stat.resolved;
      metrics[`${prefix}.${category}.unresolved`] = stat.unresolved;
    }
    return metrics;
  }
}
