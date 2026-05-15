import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/render/:id/stream — SSE bridge.
 *
 * Subscribes to the Redis Pub/Sub channel `jobs:<id>:events` and forwards each
 * message to the browser as a Server-Sent Event. If REDIS_URL is unset we fall
 * back to the mock stream so the editor UI still works on a vanilla preview.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = new Headers({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  if (!process.env.REDIS_URL) {
    const { mockStream } = await import("../../mock-stream.js");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of mockStream(id)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers });
  }

  const { subscribeToJob } = await import("@hyperframe-editor/queue");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const unsub = await subscribeToJob(id, (e) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          if (e.type === "done" || e.type === "error") {
            controller.close();
            void unsub();
          }
        } catch {
          // controller closed
        }
      });

      // Heartbeat every 25s so proxies don't drop the connection.
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          clearInterval(hb);
        }
      }, 25_000);
    },
  });
  return new Response(stream, { headers });
}
