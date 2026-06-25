import { join } from 'path';
import { writeFile, mkdir, rm, rename } from 'fs/promises';
import { createHash } from 'crypto';

export interface Artifact {
  type: string;
  path: string;
  content: string | Buffer;
}

export interface ManifestArtifact {
  type: string;
  path: string;
  checksum: string;
  sizeBytes: number;
}

export interface ArtifactManifest {
  schemaVersion: string;
  generatedAt: string;
  projectRoot: string;
  artifacts: ManifestArtifact[];
}

export class ArtifactBundleWriter {
  constructor(private projectRoot: string) {}

  async writeBundle(artifacts: Artifact[]): Promise<void> {
    const outputDir = join(this.projectRoot, '.vibesplain');
    const stagingDir = join(this.projectRoot, '.vibesplain.tmp');
    const oldDir = join(this.projectRoot, '.vibesplain.old');
    
    try {
      await rm(stagingDir, { recursive: true, force: true });
      await rm(oldDir, { recursive: true, force: true });
      
      const { existsSync } = await import('fs');
      const { cp } = await import('fs/promises');
      
      if (existsSync(outputDir)) {
        await cp(outputDir, stagingDir, { recursive: true });
      } else {
        await mkdir(stagingDir, { recursive: true });
      }

      const manifestArtifacts: ManifestArtifact[] = [];

      for (const artifact of artifacts) {
        const destPath = join(stagingDir, artifact.path);
        await mkdir(join(destPath, '..'), { recursive: true });
        
        await writeFile(destPath, artifact.content);
        
        const contentStr = artifact.content;
        const buffer = typeof contentStr === 'string' ? Buffer.from(contentStr, 'utf-8') : contentStr;
        
        manifestArtifacts.push({
          type: artifact.type,
          path: artifact.path,
          checksum: 'sha256:' + createHash('sha256').update(buffer).digest('hex'),
          sizeBytes: buffer.length,
        });
      }

      const manifest: ArtifactManifest = {
        schemaVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
        projectRoot: this.projectRoot,
        artifacts: manifestArtifacts,
      };

      await writeFile(
        join(stagingDir, 'artifact_manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8'
      );

      // Atomic swap pattern:
      // 1. Rename current -> old
      // 2. Rename staging -> current
      // 3. Remove old
      let swapped = false;
      if (existsSync(outputDir)) {
        await rename(outputDir, oldDir);
        swapped = true;
      }
      
      try {
        await rename(stagingDir, outputDir);
      } catch (err) {
        // Rollback if possible
        if (swapped) {
          await rename(oldDir, outputDir);
        }
        throw err;
      }

      if (swapped) {
        await rm(oldDir, { recursive: true, force: true });
      }

    } catch (err) {
      await rm(stagingDir, { recursive: true, force: true });
      throw err;
    }
  }
}

