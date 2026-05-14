/**
 * Redis-backed queue + pubsub.
 *
 * Why Streams? They give us exactly-once-with-ack semantics via consumer groups,
 * unlike LPUSH/BRPOP which loses messages on worker crash. Streams + Pub/Sub
 * also lets us split "the work to do" (Stream) from "in-flight progress events"
 * (Pub/Sub) — they have very different durability requirements.
 *
 * Channel naming:
 *   - jobs:queue                    XSTREAM, all enqueued jobs
 *   - jobs:queue:cg:workers         XGROUP, the worker fleet's consumer group
 *   - jobs:<jobId>:events           PUB/SUB, agent step + render progress events
 */
import { Redis } from "ioredis";

export type RedisClient = InstanceType<typeof Redis>;

let pub: RedisClient | null = null;
let sub: RedisClient | null = null;

function makeClient(): RedisClient {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");
  return new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
    enableReadyCheck: true,
  });
}

export function getRedis(): RedisClient {
  if (!pub) pub = makeClient();
  return pub;
}

export function getSubscriber(): RedisClient {
  if (!sub) sub = makeClient();
  return sub;
}

export async function closeRedis(): Promise<void> {
  await Promise.all([pub?.quit(), sub?.quit()]);
  pub = null;
  sub = null;
}

// ---------------------------------------------------------------------------
// Job queue (Streams)
// ---------------------------------------------------------------------------
export interface QueuedJob<P = Record<string, unknown>> {
  jobId: string;
  kind: string;
  projectId: string;
  payload: P;
}

const QUEUE_KEY = "jobs:queue";
const CONSUMER_GROUP = "workers";

export async function ensureGroup(client: RedisClient = getRedis()): Promise<void> {
  try {
    await client.xgroup("CREATE", QUEUE_KEY, CONSUMER_GROUP, "$", "MKSTREAM");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("BUSYGROUP")) throw e;
  }
}

export async function enqueueJob<P>(job: QueuedJob<P>): Promise<string> {
  const client = getRedis();
  const id = await client.xadd(
    QUEUE_KEY,
    "*",
    "jobId",
    job.jobId,
    "kind",
    job.kind,
    "projectId",
    job.projectId,
    "payload",
    JSON.stringify(job.payload),
  );
  if (!id) throw new Error("xadd returned null");
  return id;
}

export interface ConsumerOptions {
  consumerName: string;
  blockMs?: number;
  count?: number;
}

/**
 * Block-reads up to `count` jobs from the stream. Returns immediately with [] if no
 * jobs come in within `blockMs`. Workers loop on this and ack on success.
 */
export async function readJobs(opts: ConsumerOptions): Promise<
  Array<{ streamId: string; job: QueuedJob }>
> {
  const client = getRedis();
  await ensureGroup(client);

  const res = (await client.xreadgroup(
    "GROUP",
    CONSUMER_GROUP,
    opts.consumerName,
    "COUNT",
    opts.count ?? 1,
    "BLOCK",
    opts.blockMs ?? 5_000,
    "STREAMS",
    QUEUE_KEY,
    ">",
  )) as Array<[string, Array<[string, string[]]>]> | null;

  if (!res) return [];

  const out: Array<{ streamId: string; job: QueuedJob }> = [];
  for (const [, entries] of res) {
    for (const [streamId, fields] of entries) {
      const map = new Map<string, string>();
      for (let i = 0; i < fields.length; i += 2) {
        const k = fields[i];
        const v = fields[i + 1];
        if (k !== undefined && v !== undefined) map.set(k, v);
      }
      out.push({
        streamId,
        job: {
          jobId: map.get("jobId")!,
          kind: map.get("kind")!,
          projectId: map.get("projectId")!,
          payload: JSON.parse(map.get("payload") ?? "{}"),
        },
      });
    }
  }
  return out;
}

export async function ackJob(streamId: string): Promise<void> {
  await getRedis().xack(QUEUE_KEY, CONSUMER_GROUP, streamId);
}

// ---------------------------------------------------------------------------
// Per-job event channel (Pub/Sub)
// ---------------------------------------------------------------------------
export type JobEvent =
  | { type: "step"; step: string; status: "running" | "succeeded" | "failed" }
  | { type: "log"; level: "info" | "warn" | "error"; msg: string }
  | { type: "tool"; name: string; input?: unknown; output?: unknown; ms?: number }
  | { type: "progress"; pct: number; frame?: number; total?: number }
  | { type: "gate"; id: string; pass: boolean; severity: "block" | "warn"; details?: unknown; fix?: string }
  | { type: "done"; url?: string; gates?: Record<string, "pass" | "warn" | "fail"> }
  | { type: "error"; message: string };

export function eventChannel(jobId: string): string {
  return `jobs:${jobId}:events`;
}

export async function publishEvent(jobId: string, evt: JobEvent): Promise<void> {
  await getRedis().publish(eventChannel(jobId), JSON.stringify(evt));
}

/**
 * Subscribe to one job's event stream. Returns an unsubscribe fn.
 * The Vercel API edge uses this to bridge Redis → SSE for the browser.
 */
export async function subscribeToJob(
  jobId: string,
  onEvent: (e: JobEvent) => void,
): Promise<() => Promise<void>> {
  const client = getSubscriber();
  const channel = eventChannel(jobId);
  await client.subscribe(channel);
  const handler = (ch: string, msg: string) => {
    if (ch !== channel) return;
    try {
      onEvent(JSON.parse(msg) as JobEvent);
    } catch {
      // ignore malformed events
    }
  };
  client.on("message", handler);
  return async () => {
    client.off("message", handler);
    await client.unsubscribe(channel);
  };
}
