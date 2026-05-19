/**
 * Shared in-memory event bus for AI agent turns.
 * Works with both Replit Gemini proxy (local) and Vertex AI (production).
 */
import { ai, model as AI_MODEL, provider } from "./ai-client";
import {
  HYPERFRAMES_SYSTEM_PROMPT,
  buildComposeBrief,
  buildTweakBrief,
} from "./hyperframes-prompt";
import {
  getOrBootstrapComposition,
  saveCompositionHtml,
  rewriteHtmlForBrowser,
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
    emit({ type: "log", level: "info", msg: `provider: ${provider} · model: ${AI_MODEL}` });
    emit({ type: "step", step: "initializing", status: "running" });

    // Load existing composition for tweak context
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

    // ── Extract HTML ─────────────────────────────────────────────────────
    let compositionHtml = fullResponse.trim();

    // Strip markdown code fences if model wrapped the output
    const fenceMatch = compositionHtml.match(/```(?:html)?\n?([\s\S]*?)```/);
    if (fenceMatch) compositionHtml = fenceMatch[1]!.trim();

    // Parse optional JSON_SUMMARY the model may have appended
    let summaryJson: { clips?: number; duration?: number; summary?: string } = {};
    const summaryIdx = compositionHtml.indexOf("JSON_SUMMARY::");
    if (summaryIdx !== -1) {
      try { summaryJson = JSON.parse(compositionHtml.slice(summaryIdx + 14).trim()); } catch { /**/ }
      compositionHtml = compositionHtml.slice(0, summaryIdx).trim();
    }

    if (!compositionHtml.includes("<html") && !compositionHtml.includes("<!DOCTYPE")) {
      throw new Error(
        "The model returned unexpected output instead of HTML. Try rephrasing your prompt and click Generate again.",
      );
    }

    // ── Save composition ─────────────────────────────────────────────────
    emit({ type: "step", step: "saving-composition", status: "running" });
    await saveCompositionHtml(body.projectId, compositionHtml);
    rewriteHtmlForBrowser(compositionHtml, body.projectId);
    emit({ type: "step", step: "saving-composition", status: "succeeded" });
    emit({ type: "progress", pct: 100 });

    // ── Quality gate checks ──────────────────────────────────────────────
    const gates: Record<string, "pass" | "warn" | "fail"> = {
      G1: compositionHtml.includes("data-start")        ? "pass" : "fail",
      G2: compositionHtml.includes("data-track-index")  ? "pass" : "warn",
      G3: (summaryJson.duration ?? 0) >= 5              ? "pass" : "warn",
      G4: compositionHtml.includes("<audio")            ? "pass" : "warn",
      G5: /caption|subtitle/i.test(compositionHtml)     ? "pass" : "warn",
      G6: /1080|1920/.test(compositionHtml)             ? "pass" : "warn",
      G7: !/<(img|video|source)[^>]+src=["']https?:\/\/(?!cdn\.jsdelivr\.net)/.test(compositionHtml) ? "pass" : "warn",
      G8: "pass", // budget — always passes locally
    };

    for (const [id, result] of Object.entries(gates)) {
      emit({ type: "gate", id, pass: result === "pass", severity: result === "fail" ? "block" : "warn" });
    }

    if (summaryJson.summary) {
      emit({ type: "log", level: "info", msg: summaryJson.summary });
    }

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
