/**
 * Network-capture helper for gate G7.
 *
 * The producer (`@hyperframes/producer`) drives Chromium internally via its
 * own `puppeteer-core` capture session, but it does NOT expose a hook for
 * inspecting fetches the composition makes during a render. To still feed
 * gate G7 a faithful "what did this composition try to fetch" list, we run
 * a tiny separate scout pass: a fresh Chromium tab loads the same
 * `composition.html` over `file://`, runs for ~`captureMs` ms while the
 * GSAP timeline starts and any deferred resources resolve, then closes.
 *
 * Why scout instead of in-band:
 *   - The producer doesn't expose a request hook on its capture session.
 *   - Our authored compositions are deterministic and side-effect-free —
 *     a one-shot page load fetches the same set of URLs the producer
 *     would. (If that ever stops being true, G7 would be wrong anyway.)
 *   - The scout is ~3s; the real render is 30-90s. A 3% overhead for a
 *     truthful G7 is the right trade.
 *
 * Failure modes:
 *   - No Chromium executable found → return `{ skipped: "no-chromium", urls: [] }`.
 *     The caller treats this as "G7 unverified" rather than failing the
 *     run; the editor surfaces a warning. CI smoke tests hit this path.
 *   - Page navigation throws (file:// permissions on Vercel sandbox, etc.)
 *     → return `{ skipped: <reason>, urls: [] }`. Same handling.
 */
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export interface NetworkCaptureResult {
  /** All distinct URLs Chromium issued requests for, in encounter order. */
  urls: string[];
  /** When non-null, the capture didn't run; G7 should treat as "unverified". */
  skipped: string | null;
  /** Wall-clock ms spent in the scout pass. Useful for perf telemetry. */
  durationMs: number;
}

export interface CaptureOptions {
  /** Time-budget for the scout pass. Default 3000ms. */
  captureMs?: number;
  /**
   * Override the Chromium executable path. Defaults to
   * `process.env.PUPPETEER_EXECUTABLE_PATH`, then puppeteer's default
   * cache (`puppeteer-core` + transitive `puppeteer` install). When neither
   * resolves, the capture is skipped.
   */
  executablePath?: string;
  /** Optional pre-launch hook; tests use this to inject a fake browser. */
  launchOverride?: () => Promise<{ urls: string[] }>;
}

/**
 * Spawn a headless Chrome, point it at `htmlPath`, record every URL in
 * `Network.requestWillBeSent`, return the list. All errors are caught and
 * reported via `skipped` so the orchestrator never aborts a render just
 * because the scout failed.
 */
export async function captureNetworkLog(
  htmlPath: string,
  opts: CaptureOptions = {},
): Promise<NetworkCaptureResult> {
  const start = Date.now();
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: string): void => {
    if (!seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  if (opts.launchOverride) {
    try {
      const out = await opts.launchOverride();
      for (const u of out.urls) push(u);
      return { urls, skipped: null, durationMs: Date.now() - start };
    } catch (e) {
      return {
        urls,
        skipped: `launch-override-failed: ${(e as Error).message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // Bail early if the file we'd hand to Chromium doesn't exist. Common in
  // smoke runs that bypass the real render path.
  try {
    await fs.access(htmlPath);
  } catch {
    return { urls, skipped: "html-missing", durationMs: Date.now() - start };
  }

  // Lazy-import puppeteer-core so the synthetic backend doesn't pay the
  // module-load cost on every smoke test.
  // We type the binding with our own minimal interface and bypass tsc's
  // structural deep check on the upstream package — puppeteer-core 24's
  // `default` export shape conflicts with `import * as` under
  // `verbatimModuleSyntax`, and we only use a tiny slice of the API.
  interface PuppeteerCoreLike {
    launch: (opts: {
      executablePath: string;
      headless: boolean;
      args?: string[];
    }) => Promise<{
      newPage: () => Promise<{
        setViewport: (v: { width: number; height: number; deviceScaleFactor?: number }) => Promise<void>;
        on: (event: "request", handler: (req: { url: () => string }) => void) => void;
        goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
      }>;
      close: () => Promise<void>;
    }>;
  }
  let puppeteer: PuppeteerCoreLike;
  try {
    const mod = (await import("puppeteer-core")) as unknown as PuppeteerCoreLike & {
      default?: PuppeteerCoreLike;
    };
    puppeteer = mod.default ?? mod;
  } catch (e) {
    return {
      urls,
      skipped: `puppeteer-core-missing: ${(e as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  const exe = await resolveExecutablePath(opts.executablePath);
  if (!exe) {
    return { urls, skipped: "no-chromium", durationMs: Date.now() - start };
  }

  const captureMs = opts.captureMs ?? 3000;
  let browser: Awaited<ReturnType<PuppeteerCoreLike["launch"]>> | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: exe,
      headless: true,
      // The default args keep us out of /dev/shm trouble on small VMs and
      // disable GPU compositing (we're not rendering, just observing requests).
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    const page = await browser.newPage();
    // Lower the viewport — the page only needs to lay out enough for its
    // initial fetches. Some compositions lazy-load on intersect; we accept
    // that risk; G7 still catches the loud ones.
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

    page.on("request", (req) => {
      try {
        push(req.url());
      } catch {
        // Edge case: request object disposed. Ignore.
      }
    });

    const fileUrl = pathToFileURL(htmlPath).href;
    await page.goto(fileUrl, { waitUntil: "domcontentloaded", timeout: captureMs });
    // Drain a few extra ticks so async fetches that fired post-DCL get logged.
    // We deliberately use a fixed delay rather than networkidle — networkidle
    // can stall forever on compositions that hold open WebSocket-like fetches.
    await new Promise<void>((r) => setTimeout(r, Math.min(captureMs, 1500)));
  } catch (e) {
    return {
      urls,
      skipped: `scout-failed: ${(e as Error).message}`,
      durationMs: Date.now() - start,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }

  return { urls, skipped: null, durationMs: Date.now() - start };
}

async function resolveExecutablePath(override?: string): Promise<string | null> {
  if (override) {
    try {
      await fs.access(override);
      return override;
    } catch {
      return null;
    }
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    try {
      await fs.access(process.env.PUPPETEER_EXECUTABLE_PATH);
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    } catch {
      return null;
    }
  }
  // Try the full `puppeteer` package's default install location. We don't
  // depend on `puppeteer` directly — the producer pulls it in transitively
  // and its postinstall downloads chrome-headless-shell to ~/.cache/puppeteer.
  try {
    const pkg = await import("puppeteer" as never);
    type PuppeteerNS = { executablePath?: () => string };
    const ns = pkg as unknown as PuppeteerNS | { default: PuppeteerNS };
    const exe =
      typeof (ns as PuppeteerNS).executablePath === "function"
        ? (ns as PuppeteerNS).executablePath!()
        : typeof (ns as { default: PuppeteerNS }).default?.executablePath === "function"
          ? (ns as { default: PuppeteerNS }).default.executablePath!()
          : null;
    if (exe) {
      try {
        await fs.access(exe);
        return exe;
      } catch {
        return null;
      }
    }
  } catch {
    // puppeteer not available in this env (CI, dev without browser ensure).
  }
  // Last-ditch: search ~/.cache/puppeteer for any chrome-headless-shell binary.
  // The hyperframes browser-ensure CLI drops it there.
  try {
    const home = process.env.HOME ?? "/root";
    const cacheRoot = `${home}/.cache/puppeteer/chrome-headless-shell`;
    const versions = await fs.readdir(cacheRoot).catch(() => []);
    for (const v of versions) {
      const platDir = `${cacheRoot}/${v}`;
      const plats = await fs.readdir(platDir).catch(() => []);
      for (const p of plats) {
        const cand = `${platDir}/${p}/chrome-headless-shell`;
        try {
          await fs.access(cand);
          return cand;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Legacy mutable-log API kept for back-compat with existing callers and tests.
 * New code should call `captureNetworkLog` directly and consume the result.
 */
export function newNetworkLog(): string[] {
  return [];
}
export function recordRequest(log: string[], url: string): void {
  if (!log.includes(url)) log.push(url);
}

// Avoid unused-import warning for `dirname` — kept exported in case callers
// want to derive sibling paths from the html input.
export const _internal = { dirname };
