/**
 * Shared in-memory event bus for AI agent turns.
 * Works with both Replit Gemini proxy (local) and Vertex AI (production).
 *
 * Gate checks implement the HyperFrames "Rule of Three":
 *  G1 — Root element has data-composition-id, data-width, data-height
 *  G2 — Root element has data-start and data-duration
 *  G3 — All .clip elements have data-start, data-duration, data-track-index
 *  G4 — GSAP timeline registered on window.__timelines (paused:true)
 *  G5 — No wall-clock animations (setTimeout/setInterval/rAF)
 *  G6 — Canvas dimensions match common presets
 *  G7 — Audio present (optional — warn only)
 *  G8 — No off-origin media that would break headless render
 */
import { getAiClient } from "./ai-client";
import {
  HYPERFRAMES_SYSTEM_PROMPT,
  buildComposeBrief,
  buildTweakBrief,
  canvasForPreset,
} from "./hyperframes-prompt";
import {
  getOrBootstrapComposition,
  normalizeHtmlForCanvas,
  saveCompositionHtml,
  parseRootAttrs,
  parseClipsFromHtml,
} from "./composition";
import { logger } from "./logger";

export interface AgentTurnInput {
  projectId: string;
  prompt: string;
  kind: "compose" | "tweak";
  presetId: string;
}

// In-process event buffers — shared across all routes
export const turnEvents = new Map<string, unknown[]>();
export const turnDone = new Map<string, boolean>();

export function startAgentTurn(turnId: string, input: AgentTurnInput): void {
  turnEvents.set(turnId, []);
  turnDone.set(turnId, false);
  void runAgentTurn(turnId, input);
}

async function runAgentTurn(turnId: string, body: AgentTurnInput) {
  const emit = (event: unknown) => {
    const buf = turnEvents.get(turnId) ?? [];
    buf.push(event);
    turnEvents.set(turnId, buf);
  };

  try {
    const { ai, model: AI_MODEL, provider } = getAiClient();

    emit({ type: "log", level: "info", msg: `provider: ${provider} · model: ${AI_MODEL}` });
    emit({ type: "step", step: "initializing", status: "running" });

    // Load existing composition HTML for tweak context
    let contextHtml = "";
    if (body.kind === "tweak") {
      const { html } = await getOrBootstrapComposition(body.projectId);
      contextHtml = html;
      emit({ type: "step", step: "loading-composition", status: "succeeded" });
    }

    const userPrompt =
      body.kind === "tweak"
        ? buildTweakBrief(body.prompt, contextHtml)
        : buildComposeBrief(body.prompt, body.presetId);

    emit({ type: "step", step: "generating-composition", status: "running" });
    emit({ type: "log", level: "info", msg: `${AI_MODEL} · ${body.kind}…` });

    // Stream from whichever provider is active
    const stream = await ai.models.generateContentStream({
      model: AI_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: HYPERFRAMES_SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
    });

    let fullResponse = "";
    let chunkCount = 0;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        chunkCount++;
        if (chunkCount % 5 === 0) {
          const pct = Math.min(85, Math.round((fullResponse.length / 5000) * 80));
          emit({ type: "progress", pct });
        }
      }
    }

    emit({ type: "step", step: "generating-composition", status: "succeeded" });
    emit({ type: "progress", pct: 90 });

    logger.info(
      { turnId, chars: fullResponse.length, chunks: chunkCount, provider },
      "agent turn: generation complete",
    );

    // ── Extract HTML ──────────────────────────────────────────────────────
    let compositionHtml = fullResponse.trim();

    // Strip markdown fences if the model wrapped output anyway
    const fenceMatch = compositionHtml.match(/```(?:html)?\n?([\s\S]*?)```/);
    if (fenceMatch) compositionHtml = fenceMatch[1]!.trim();

    // Parse optional JSON_SUMMARY the model appended after </html>
    let summaryJson: { clips?: number; duration?: number; summary?: string } = {};
    const summaryIdx = compositionHtml.indexOf("JSON_SUMMARY::");
    if (summaryIdx !== -1) {
      try { summaryJson = JSON.parse(compositionHtml.slice(summaryIdx + 14).trim()); } catch { /**/ }
      compositionHtml = compositionHtml.slice(0, summaryIdx).trim();
    }

    if (!compositionHtml.includes("<html") && !compositionHtml.includes("<!DOCTYPE")) {
      throw new Error(
        "Gemini returned unexpected output instead of HTML. Try rephrasing your prompt.",
      );
    }

    // ── Save composition ──────────────────────────────────────────────────
    emit({ type: "step", step: "saving-composition", status: "running" });
    const presetCanvas = canvasForPreset(body.presetId);
    compositionHtml = normalizeHtmlForCanvas(compositionHtml, presetCanvas);
    await saveCompositionHtml(body.projectId, compositionHtml, presetCanvas);
    // HTML is rewritten for browser on every GET /api/projects/:id/composition request
    emit({ type: "step", step: "saving-composition", status: "succeeded" });
    emit({ type: "progress", pct: 100 });

    // ── HyperFrames Rule of Three gate checks ─────────────────────────────
    // Based on official HyperFrames lint rules:
    // https://hyperframes.heygen.com | github.com/heygen-com/hyperframes

    const rootAttrs = parseRootAttrs(compositionHtml);
    const { clipCount, maxEnd } = parseClipsFromHtml(compositionHtml);
    const totalDuration =
      rootAttrs.duration > 0 ? rootAttrs.duration
      : (summaryJson.duration ?? maxEnd);

    // G1: Root element has the three required attrs (data-composition-id, data-width, data-height)
    const hasCompId   = /data-composition-id="[^"]+"/.test(compositionHtml);
    const hasWidth    = /data-width="[\d]+"/.test(compositionHtml);
    const hasHeight   = /data-height="[\d]+"/.test(compositionHtml);
    const g1Pass      = hasCompId && hasWidth && hasHeight;

    // G2: Root element has data-start and data-duration (timing contract)
    const rootHasStart = /data-start="0"/.test(compositionHtml);
    const rootHasDur   = /data-duration="[\d.]+"/.test(compositionHtml);
    const g2Pass       = rootHasStart && rootHasDur;

    // G3: Every .clip element has all three required timing attributes
    // We check: clips found AND maxEnd > 0 (implies data-start + data-duration)
    const hasTrackIndex = compositionHtml.includes("data-track-index=");
    const g3Pass = clipCount > 0 && maxEnd > 0 && hasTrackIndex;

    // G4: GSAP timeline registered on window.__timelines with paused:true
    const hasTimelines  = compositionHtml.includes("window.__timelines");
    const hasPausedTrue = /paused\s*:\s*true/.test(compositionHtml);
    const g4Pass = hasTimelines && hasPausedTrue;

    // G5: No wall-clock animations (breaks deterministic seeking)
    const hasWallClock = /setTimeout|setInterval|requestAnimationFrame/.test(compositionHtml);
    const g5Pass = !hasWallClock;

    // G6: Canvas dimensions present and reasonable (Rule of Three)
    const w = rootAttrs.width;
    const h = rootAttrs.height;
    const validDims = [
      [1920, 1080], [1080, 1920], [1080, 1080],
      [1280, 720],  [720, 1280],
    ];
    const g6Pass = validDims.some(([vw, vh]) => w === vw && h === vh);

    // G7: Audio present (informational — warn if missing)
    const hasAudio = compositionHtml.includes("<audio");
    const g7Pass = hasAudio; // warn if absent

    // G8: No off-origin media URLs that would break headless render
    // Allow: cdnjs.cloudflare.com, cdn.jsdelivr.net, fonts.googleapis.com, data: URIs
    const offOriginRe = /<(?:img|video|source)\b[^>]+src=["']https?:\/\/(?!cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.gstatic\.com|fonts\.googleapis\.com)/.test(compositionHtml);
    const g8Pass = !offOriginRe;

    const gates: Record<string, "pass" | "warn" | "fail"> = {
      G1: g1Pass ? "pass" : "fail",  // blocking: no root attrs = render fails
      G2: g2Pass ? "pass" : "warn",
      G3: g3Pass ? "pass" : "fail",  // blocking: no clips = empty video
      G4: g4Pass ? "pass" : "warn",  // warn: animations won't play in renderer
      G5: g5Pass ? "pass" : "warn",  // warn: deterministic seeking may break
      G6: g6Pass ? "pass" : "warn",
      G7: g7Pass ? "pass" : "warn",  // warn: no audio (informational)
      G8: g8Pass ? "pass" : "warn",  // warn: off-origin media
    };

    for (const [id, result] of Object.entries(gates)) {
      emit({
        type: "gate",
        id,
        pass: result === "pass",
        severity: result === "fail" ? "block" : "warn",
      });
    }

    const composeSummary = summaryJson.summary
      ?? `${clipCount} clip${clipCount !== 1 ? "s" : ""} · ${totalDuration.toFixed(1)}s · ${rootAttrs.width}×${rootAttrs.height}`;

    emit({ type: "log", level: "info", msg: composeSummary });
    emit({ type: "done", gates });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ turnId, err: msg }, "agent turn failed");
    emit({ type: "error", message: msg });
  } finally {
    turnDone.set(turnId, true);
    // Clean up event buffer after 10 minutes
    setTimeout(() => {
      turnEvents.delete(turnId);
      turnDone.delete(turnId);
    }, 10 * 60 * 1000);
  }
}
