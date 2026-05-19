import { Router, type IRouter } from "express";

const router: IRouter = Router();

// GET /api/stock/:provider?q=...&kind=image|video&perPage=20
router.get("/stock/:provider", async (req, res) => {
  const { provider } = req.params;
  const q = (req.query.q as string) ?? "";
  const kind = ((req.query.kind as string) ?? "image") as "image" | "video";
  const perPage = Number(req.query.perPage ?? "20");
  const orientation = ((req.query.orientation as string) ?? "any") as
    | "any"
    | "horizontal"
    | "vertical"
    | "square";

  if (!q) return res.json({ hits: [] });

  try {
    let hits: unknown[] = [];
    if (provider === "pixabay") {
      if (!process.env.PIXABAY_API_KEY) return res.json({ hits, missingKey: true });
      // @ts-ignore
      const { pixabay } = await import("@hyperframe-editor/providers");
      hits = await pixabay.search({ query: q, kind, perPage, orientation });
    } else if (provider === "unsplash") {
      if (!process.env.UNSPLASH_ACCESS_KEY) return res.json({ hits, missingKey: true });
      // @ts-ignore
      const { unsplash } = await import("@hyperframe-editor/providers");
      hits = await unsplash.search({ query: q, kind, perPage, orientation });
    } else if (provider === "freepik") {
      const apiKey = req.headers["x-freepik-api-key"] as string | undefined;
      if (!apiKey) return res.json({ hits, missingKey: true });
      // @ts-ignore
      const { freepik } = await import("@hyperframe-editor/providers");
      hits = await freepik.search({ query: q, kind, perPage, orientation, apiKey });
    } else {
      return res.status(404).json({ error: `unknown provider: ${provider}` });
    }
    return res.json({ hits });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
