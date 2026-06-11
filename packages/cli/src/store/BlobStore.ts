import { createHash } from 'crypto';
import { mkdir, writeFile, open, rename, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface BlobWriteResult {
  contentHash: string;  // 'sha256:<hex>'
  blobPath: string;     // absolute path to blob file
}

export class BlobStore {
  private blobsDir: string;
  private tmpDir: string;

  constructor(projectRoot: string) {
    this.blobsDir = join(projectRoot, '.vibe-splainer', 'blobs');
    this.tmpDir   = join(projectRoot, '.vibe-splainer', 'tmp');
  }

  async ensureDirs(): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true });
    await mkdir(this.tmpDir,   { recursive: true });
  }

  async writeAtomic(payload: Buffer | string): Promise<BlobWriteResult> {
    await this.ensureDirs();

    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const hex = createHash('sha256').update(buf).digest('hex');
    const contentHash = `sha256:${hex}`;
    const blobPath = join(this.blobsDir, `sha256_${hex}`);

    if (existsSync(blobPath)) {
      return { contentHash, blobPath };
    }

    const tmpPath = join(this.tmpDir, `tmp_${hex}_${Date.now()}`);
    await writeFile(tmpPath, buf);

    // fsync the file before rename
    const fh = await open(tmpPath, 'r');
    try {
      await fh.datasync();
    } finally {
      await fh.close();
    }

    await rename(tmpPath, blobPath);
    return { contentHash, blobPath };
  }

  async readBlob(blobPath: string): Promise<Buffer> {
    const { readFile } = await import('fs/promises');
    return readFile(blobPath);
  }

  async blobExists(contentHash: string): Promise<boolean> {
    const hex = contentHash.replace('sha256:', '');
    const blobPath = join(this.blobsDir, `sha256_${hex}`);
    return existsSync(blobPath);
  }

  blobPathForHash(contentHash: string): string {
    const hex = contentHash.replace('sha256:', '');
    return join(this.blobsDir, `sha256_${hex}`);
  }

  async verifyIntegrity(blobPath: string, expectedHash: string): Promise<boolean> {
    try {
      const { readFile } = await import('fs/promises');
      const buf = await readFile(blobPath);
      const hex = createHash('sha256').update(buf).digest('hex');
      return `sha256:${hex}` === expectedHash;
    } catch {
      return false;
    }
  }

  /** List all blob paths for GC reference counting */
  async listBlobPaths(): Promise<string[]> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(this.blobsDir);
      return files
        .filter(f => f.startsWith('sha256_'))
        .map(f => join(this.blobsDir, f));
    } catch {
      return [];
    }
  }

  async getBlobSize(blobPath: string): Promise<number> {
    try {
      const info = await stat(blobPath);
      return info.size;
    } catch {
      return 0;
    }
  }
}

/** Hash a string or buffer without writing it */
export function computeHash(payload: Buffer | string): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

/** Hash a file on disk */
export async function hashFile(filePath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  const buf = await readFile(filePath);
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}
