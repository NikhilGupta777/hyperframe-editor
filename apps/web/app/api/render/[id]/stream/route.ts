import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/render/:id/stream — SSE bridge.
 *
 * Subscribes to the Redis Pub/Sub channel `jobs:<id>:events` and forwards each
 * message to the browser as a Server-Sent Event. If REDIS_URL is unset we fall
 * back to the mock stream so the editor UI still works on a vanilla preview.
 *
 * Cleanup contract:
 *   - On `done` or `error`, we close the controller and unsubscribe from Redis.
 *   - On the request being aborted (browser tab closed / EventSource.close),
 *     `req.signal` fires and we tear everything down.
 *   - The 25s heartbeat is cleared in every exit path so we don't leak
 *     intervals when a stream ends quickly.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = new Headers({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Some proxies (Cloudflare, nginx) buffer SSE without this hint.
    "x-accel-buffering": "no",
  });

  if (!process.env.REDIS_URL) {
    const { mockStream } = await import("../../mock-stream.js");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of mockStream(id)) {
            if (req.signal.aborted) break;
            controller.enqueue(encoder.encode(chunk));
          }
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });
    return new Response(stream, { headers });
  }

  const { subscribeToJob } = await import("@hyperframe-editor/queue");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let unsub: (() => Promise<void>) | null = null;

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsub) {
          try {
            await unsub();
          } catch {
            // ignore
          }
          unsub = null;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Tear down if the client disconnects mid-stream.
      req.signal.addEventListener("abort", () => {
        void cleanup();
      });

      unsub = await subscribeToJob(id, (e) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          void cleanup();
          return;
        }
        if (e.type === "done" || e.type === "error") {
          void cleanup();
        }
      });

      // Heartbeat every 25s so proxies don't drop the connection.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          void cleanup();
        }
      }, 25_000);
    },
  });
  return new Response(stream, { headers });
}
