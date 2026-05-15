/**
 * Object storage adapter. OCI Object Storage exposes an S3-compatible endpoint, so we
 * use the AWS SDK v3 with a custom endpoint. Same code works against MinIO in dev and
 * Cloudflare R2 if we ever flip the cloud-fallback flag.
 *
 * Env vars (all required at runtime):
 *   STORAGE_ENDPOINT      e.g. https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
 *   STORAGE_REGION        e.g. us-ashburn-1 (must match the endpoint region for SigV4)
 *   STORAGE_ACCESS_KEY_ID
 *   STORAGE_SECRET_ACCESS_KEY
 *   STORAGE_BUCKET        bucket name
 *   STORAGE_PUBLIC_BASE_URL (optional) — if set, getPublicUrl() returns clean URLs
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

export interface StorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

export function configFromEnv(): StorageConfig {
  const required = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing env var: ${k}`);
    return v;
  };
  return {
    endpoint: required("STORAGE_ENDPOINT"),
    region: required("STORAGE_REGION"),
    accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
    bucket: required("STORAGE_BUCKET"),
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL,
  };
}

export class Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl?: string;

  constructor(cfg: StorageConfig) {
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // OCI requires path-style addressing; bucket-virtual-hosted-style won't work.
      forcePathStyle: true,
    });
  }

  /**
   * Uploads bytes (Buffer / string / stream) to a key. Returns the canonical oci:// URI.
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | string | Readable,
    contentType?: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body as Buffer,
        ContentType: contentType,
      }),
    );
    return `oci://${this.bucket}/${key}`;
  }

  /** Fetches an object as a Buffer. Use for small artifacts (compositions, JSON reports). */
  async getObject(key: string): Promise<Buffer> {
    const resp = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = resp.Body as Readable | undefined;
    if (!stream) throw new Error(`Empty object body: ${key}`);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  /** True if the object exists. */
  async headObject(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Mints a pre-signed PUT URL the browser can upload to directly. Required for
   * source uploads — Vercel functions can't proxy multi-hundred-MB videos.
   */
  async signUploadUrl(key: string, contentType: string, ttlSec = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSec },
    );
  }

  /** Pre-signed GET URL for download / preview. */
  async signDownloadUrl(key: string, ttlSec = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSec },
    );
  }

  /** Stable public URL (or signed URL fallback). */
  async getUrl(key: string, ttlSec = 900): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return this.signDownloadUrl(key, ttlSec);
  }

  /**
   * Parse oci://bucket/key/path back into its parts. Throws when the URI's
   * bucket doesn't match the configured one — silently reading from a
   * different bucket would mask config errors and surface as 404s downstream.
   */
  parseUri(uri: string): { bucket: string; key: string } {
    const m = uri.match(/^oci:\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`Not an oci:// URI: ${uri}`);
    const bucket = m[1]!;
    const key = m[2]!;
    if (bucket !== this.bucket) {
      throw new Error(
        `oci:// bucket mismatch: uri is "${bucket}" but Storage is configured for "${this.bucket}"`,
      );
    }
    return { bucket, key };
  }
}

let cached: Storage | null = null;
export function getStorage(): Storage {
  if (!cached) cached = new Storage(configFromEnv());
  return cached;
}

/**
 * Convenience: storage paths for one project.
 */
export const paths = {
  projectRoot: (projectId: string) => `projects/${projectId}/`,
  composition: (projectId: string) => `projects/${projectId}/composition.html`,
  asset: (projectId: string, name: string) => `projects/${projectId}/assets/${name}`,
  render: (projectId: string, ts: string) => `renders/${projectId}/${ts}.mp4`,
  cached: (sha: string, ext: string) => `asset-cache/${sha.slice(0, 2)}/${sha}.${ext}`,
};
