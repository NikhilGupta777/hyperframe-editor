/**
 * Pack a transcript into a ~12KB markdown view (the video-use trick).
 *
 * Phase 1 produces the format; Phase 2's editSource loop feeds the packed view
 * back to Gemini 3.1 Pro to propose an EDL without ever sending the raw video.
 */
import type { TranscriptSegment } from "@hyperframe-editor/providers/vertex";

export interface PackedSource {
  id: string;
  durationSec: number;
  segmentsBySpeaker: Array<{
    speaker: string;
    phrases: Array<{ start: number; end: number; text: string }>;
  }>;
}

export function packTranscript(
  sourceId: string,
  durationSec: number,
  segments: TranscriptSegment[],
): { packed: string; structured: PackedSource } {
  const bySpeaker = new Map<string, Array<{ start: number; end: number; text: string }>>();
  for (const seg of segments) {
    const sp = seg.speaker ?? "S0";
    const list = bySpeaker.get(sp) ?? [];
    list.push({ start: seg.start, end: seg.end, text: seg.text.trim() });
    bySpeaker.set(sp, list);
  }

  const lines: string[] = [];
  lines.push(`## ${sourceId}  (duration: ${durationSec.toFixed(1)}s, ${segments.length} segments)`);
  for (const [sp, phrases] of bySpeaker) {
    for (const p of phrases) {
      lines.push(
        `  [${formatTime(p.start)}-${formatTime(p.end)}] ${sp} ${p.text}`,
      );
    }
  }

  return {
    packed: lines.join("\n"),
    structured: {
      id: sourceId,
      durationSec,
      segmentsBySpeaker: [...bySpeaker.entries()].map(([speaker, phrases]) => ({
        speaker,
        phrases,
      })),
    },
  };
}

function formatTime(s: number): string {
  return s.toFixed(2).padStart(6, "0");
}
