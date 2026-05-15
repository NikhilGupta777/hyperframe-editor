/**
 * In-memory mock for the Vercel preview deploy where there's no Redis backend.
 * Drives a deterministic 8-event stream that matches the real worker's SSE shape.
 *
 * NEVER use this in prod: it drops events on cold-start and doesn't survive
 * re-deploys. The whole point of Vercel + Oracle is that the real worker runs
 * elsewhere; this is purely "the editor UI works in a fresh fork without infra".
 */

interface MockJob {
  jobId: string;
  prompt: string;
  presetId: string;
}

const jobs = new Map<string, MockJob>();

export function mockEnqueue(j: { jobId: string; payload: { prompt: string; presetId: string } }) {
  jobs.set(j.jobId, {
    jobId: j.jobId,
    prompt: j.payload.prompt,
    presetId: j.payload.presetId,
  });
}

export async function* mockStream(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) {
    yield evt({ type: "error", message: `unknown job: ${jobId}` });
    return;
  }
  yield evt({ type: "step", step: "WRITE_BRIEF", status: "running" });
  await sleep(300);
  yield evt({ type: "log", level: "info", msg: `brief: ${job.prompt.slice(0, 60)}…` });
  await sleep(200);
  yield evt({ type: "step", step: "PLAN_BEATS", status: "running" });
  await sleep(300);
  yield evt({ type: "log", level: "info", msg: "plan: 4 beats, 30.0s total" });
  await sleep(200);
  yield evt({ type: "step", step: "COMPOSE", status: "running" });
  await sleep(400);
  yield evt({ type: "step", step: "LINT", status: "running" });
  await sleep(200);
  yield evt({ type: "log", level: "info", msg: "lint pass: attempts=1, errors=0" });
  await sleep(200);
  yield evt({ type: "step", step: "RENDER", status: "running" });
  for (const pct of [10, 25, 40, 60, 80, 100]) {
    await sleep(150);
    yield evt({ type: "progress", pct });
  }
  for (const id of ["G1", "G2", "G3", "G7", "G8"]) {
    yield evt({ type: "gate", id, pass: true, severity: "block" });
  }
  for (const id of ["G4", "G5", "G6"]) {
    yield evt({ type: "gate", id, pass: true, severity: "warn" });
  }
  // Synthetic cost events so the editor's top-bar pill ticks up like in prod.
  yield evt({
    type: "tool",
    name: "cost",
    output: {
      provider: "vertex-gemini-3.1-pro",
      unit: "tokens-out",
      qty: 320,
      costUsd: 320 * (10 / 1_000_000),
    },
  });
  yield evt({
    type: "tool",
    name: "cost",
    output: {
      provider: "oracle-render",
      unit: "render-second",
      qty: 30,
      costUsd: 30 * 0.001,
    },
  });
  yield evt({
    type: "tool",
    name: "costSummary",
    output: { totalUsd: Number((320 * (10 / 1_000_000) + 30 * 0.001).toFixed(6)) },
  });
  yield evt({
    type: "done",
    url: undefined, // no real MP4 in mock mode
    gates: {
      G1: "pass",
      G2: "pass",
      G3: "pass",
      G4: "pass",
      G5: "pass",
      G6: "pass",
      G7: "pass",
      G8: "pass",
    },
  });
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
function evt(o: unknown): string {
  return `data: ${JSON.stringify(o)}\n\n`;
}
