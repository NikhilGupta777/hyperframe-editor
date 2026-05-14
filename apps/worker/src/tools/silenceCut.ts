/**
 * `silence_cut` tool — turns a source video plus its silence segments into
 * the EDL of "kept" cuts. The orchestrator can then feed the EDL into the
 * EDIT-SOURCE composer (composeOverEDL) to render the cleaned clip.
 *
 * Inputs:
 *   sourceUri       — path or oci:// URI of the source video
 *   noiseDb         — silence threshold in dBFS (default -30)
 *   minDurationSec  — minimum gap to count as silence (default 0.5)
 *   pad             — keep N seconds of leading/trailing silence around each
 *                     kept segment so the cut doesn't sound abrupt (default 0.05)
 *
 * Output: { kept: SilenceSegment[] } — the inverse of the silent regions.
 */
import { silenceDetect, probe } from "@hyperframe-editor/ffmpeg";

export interface KeptSegment {
  start: number;
  end: number;
}

export interface SilenceCutOptions {
  sourceUri: string;
  noiseDb?: number;
  minDurationSec?: number;
  pad?: number;
}

export async function silenceCut(opts: SilenceCutOptions): Promise<{ kept: KeptSegment[] }> {
  const sources = await probe(opts.sourceUri);
  const total = sources.durationSec;
  const silences = await silenceDetect(
    opts.sourceUri,
    opts.noiseDb ?? -30,
    opts.minDurationSec ?? 0.5,
  );
  const pad = opts.pad ?? 0.05;
  const kept: KeptSegment[] = [];

  let cursor = 0;
  for (const s of silences) {
    const segEnd = Math.max(0, s.start + pad);
    if (segEnd > cursor) kept.push({ start: cursor, end: Math.min(segEnd, total) });
    cursor = Math.max(0, s.end - pad);
  }
  if (cursor < total) kept.push({ start: cursor, end: total });

  // Defensive: drop sub-frame slivers that produce empty cuts.
  return { kept: kept.filter((k) => k.end - k.start > 0.04) };
}
