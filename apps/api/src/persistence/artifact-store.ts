import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Database } from './database.js';

export type ArtifactKind = 'workflow_jobs' | 'job_log' | 'trigger_diff';

export type ArtifactInput = {
  incidentId: string;
  kind: ArtifactKind;
  contentType: 'application/json' | 'text/plain';
  content: Buffer;
};

export type DecryptedArtifact = {
  kind: ArtifactKind;
  sha256: string;
  contentType: string;
  content: Buffer;
};

const maximumArtifactBytes = 5 * 1024 * 1024;

export class EncryptedArtifactStore {
  constructor(
    private readonly database: Database,
    private readonly encryptionKey: Buffer
  ) {}

  async put(input: ArtifactInput): Promise<{ sha256: string; inserted: boolean }> {
    if (input.content.byteLength > maximumArtifactBytes) {
      throw new Error(`Artifact exceeds ${maximumArtifactBytes} byte storage limit`);
    }

    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(input.content), cipher.final()]);
    const tag = cipher.getAuthTag();

    const result = await this.database.pool.query(
      `INSERT INTO artifacts (
        incident_id, kind, sha256, content_type, byte_length,
        encryption_algorithm, encryption_iv, encryption_tag, ciphertext
      ) VALUES ($1, $2, $3, $4, $5, 'aes-256-gcm', $6, $7, $8)
      ON CONFLICT (incident_id, kind, sha256) DO NOTHING
      RETURNING id`,
      [input.incidentId, input.kind, sha256, input.contentType, input.content.byteLength, iv, tag, ciphertext]
    );
    return { sha256, inserted: result.rowCount === 1 };
  }

  async listForIncident(incidentId: string): Promise<DecryptedArtifact[]> {
    const result = await this.database.pool.query<{
      kind: ArtifactKind;
      sha256: string;
      content_type: string;
      encryption_iv: Buffer;
      encryption_tag: Buffer;
      ciphertext: Buffer;
    }>(
      `SELECT kind, sha256, content_type, encryption_iv, encryption_tag, ciphertext
       FROM artifacts WHERE incident_id = $1 ORDER BY created_at ASC`,
      [incidentId]
    );

    return result.rows.map((artifact) => {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, artifact.encryption_iv);
      decipher.setAuthTag(artifact.encryption_tag);
      const content = Buffer.concat([decipher.update(artifact.ciphertext), decipher.final()]);
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== artifact.sha256) {
        throw new Error(`Artifact integrity verification failed for ${artifact.sha256}`);
      }
      return {
        kind: artifact.kind,
        sha256: artifact.sha256,
        contentType: artifact.content_type,
        content
      };
    });
  }
}
