/**
 * Object storage adapter. Uses AWS SDK v3 — works with:
 *   - Amazon S3 (default)
 *   - Any S3-compatible service (MinIO, Cloudflare R2, OCI Object Storage)
 *
 * For native AWS S3, only these env vars are needed:
 *   AWS_REGION             e.g. us-east-1
 *   AWS_ACCESS_KEY_ID      IAM access key
 *   AWS_SECRET_ACCESS_KEY  IAM secret key
 *   STORAGE_BUCKET         bucket name
 *
 * For S3-compatible services, also set:
 *   STORAGE_ENDPOINT       e.g. https://s3.us-east-1.amazonaws.com (or custom)
 *
 * Optional:
 *   STORAGE_PUBLIC_BASE_URL — if set, getUrl() returns clean public URLs
 *   STORAGE_FORCE_PATH_STYLE — set to "1" for MinIO/OCI (path-style addressing)
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
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
  forcePathStyle?: boolean;
}

export function configFromEnv(): StorageConfig {
  const required = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing env var: ${k}`);
    return v;
  };

  // Support both AWS-standard naming and the legacy STORAGE_* naming
  const region =
    process.env.AWS_REGION ?? process.env.STORAGE_REGION ?? "us-east-1";
  const accessKeyId =
    process.env.AWS_ACCESS_KEY_ID ?? process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY ?? process.env.STORAGE_SECRET_ACCESS_KEY;

  if (!accessKeyId) throw new Error("Missing env var: AWS_ACCESS_KEY_ID (or STORAGE_ACCESS_KEY_ID)");
  if (!secretAccessKey) throw new Error("Missing env var: AWS_SECRET_ACCESS_KEY (or STORAGE_SECRET_ACCESS_KEY)");

  return {
    endpoint: process.env.STORAGE_ENDPOINT, // undefined = native AWS S3
    region,
    accessKeyId,
    secretAccessKey,
    bucket: required("STORAGE_BUCKET"),
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "1",
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
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // Native AWS S3 uses virtual-hosted-style by default; path-style is for
      // S3-compatible services (MinIO, OCI). Only force it when configured.
      forcePathStyle: cfg.forcePathStyle ?? false,
    });
  }

  /**
   * Uploads bytes (Buffer / string / stream) to a key. Returns the s3:// URI.
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
    return `s3://${this.bucket}/${key}`;
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
   * Parse s3://bucket/key/path (or legacy oci://bucket/key) back into parts.
   * Throws when the URI's bucket doesn't match the configured one.
   */
  parseUri(uri: string): { bucket: string; key: string } {
    const m = uri.match(/^(?:s3|oci):\/\/([^/]+)\/(.+)$/);
    if (!m) throw new Error(`Not an s3:// or oci:// URI: ${uri}`);
    const bucket = m[1]!;
    const key = m[2]!;
    if (bucket !== this.bucket) {
      throw new Error(
        `Storage bucket mismatch: uri is "${bucket}" but Storage is configured for "${this.bucket}"`,
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
