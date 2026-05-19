import { NextResponse } from "next/server";
import type { StockHit } from "@hyperframe-editor/providers";

export const runtime = "nodejs";

/**
 * GET /api/stock/:provider?q=...&kind=image|video&perPage=20&orientation=any
 *
 * Proxies stock-image searches to the provider package. Why proxy? So the
 * provider keys never reach the browser, and so our cost/cache/attribution
 * logic stays server-side.
 *
 * If no key is configured we return an empty result rather than 500ing — the
 * editor degrades gracefully on a vanilla preview deploy.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const kind = (url.searchParams.get("kind") as "image" | "video" | null) ?? "image";
  const perPage = Number(url.searchParams.get("perPage") ?? "20");
  const orientation =
    (url.searchParams.get("orientation") as
      | "any"
      | "horizontal"
      | "vertical"
      | "square"
      | null) ?? "any";

  if (!q) return NextResponse.json({ hits: [] });

  try {
    let hits: StockHit[] = [];
    if (provider === "pixabay") {
      if (!process.env.PIXABAY_API_KEY) return NextResponse.json({ hits, missingKey: true });
      const { pixabay } = await import("@hyperframe-editor/providers");
      hits = await pixabay.search({ query: q, kind, perPage, orientation });
    } else if (provider === "unsplash") {
      if (!process.env.UNSPLASH_ACCESS_KEY)
        return NextResponse.json({ hits, missingKey: true });
      const { unsplash } = await import("@hyperframe-editor/providers");
      hits = await unsplash.search({ query: q, kind, perPage, orientation });
    } else if (provider === "freepik") {
      // Freepik is BYOK; we accept the key on the request (header) so we never
      // store it server-side.
      const apiKey = req.headers.get("x-freepik-api-key");
      if (!apiKey) return NextResponse.json({ hits, missingKey: true });
      const { freepik } = await import("@hyperframe-editor/providers");
      hits = await freepik.search({ query: q, kind, perPage, orientation, apiKey });
    } else {
      return NextResponse.json({ error: `unknown provider: ${provider}` }, { status: 404 });
    }
    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
