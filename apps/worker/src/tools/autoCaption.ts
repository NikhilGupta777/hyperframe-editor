/**
 * `auto_caption` tool — given a transcript, emit an SRT file plus a typed list
 * the composition builder turns into a CaptionBlock.
 *
 * Style matters here: TikTok-style captions are 2-word UPPERCASE chunks with a
 * black stroke + drop shadow. The CaptionBlock component already handles the
 * presentation; this function decides where the cut points are.
 */
import { writeFile } from "node:fs/promises";
import type { TranscriptSegment } from "@hyperframe-editor/providers/vertex";

export interface CaptionStyle {
  /** "tiktok" → 2-word UPPERCASE chunks, "subtitle" → standard segments. */
  variant: "tiktok" | "subtitle";
  /** Max characters per chunk for "subtitle"; ignored for "tiktok". */
  maxChars?: number;
}

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export interface AutoCaptionResult {
  lines: CaptionLine[];
  srtPath?: string;
}

export async function autoCaption(
  segments: TranscriptSegment[],
  style: CaptionStyle = { variant: "tiktok" },
  outputSrtPath?: string,
): Promise<AutoCaptionResult> {
  const lines = chunkCaptions(segments, style);
  if (outputSrtPath) {
    await writeFile(outputSrtPath, toSrt(lines), "utf8");
    return { lines, srtPath: outputSrtPath };
  }
  return { lines };
}

function chunkCaptions(segments: TranscriptSegment[], style: CaptionStyle): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const seg of segments) {
    if (style.variant === "tiktok") {
      out.push(...chunkTikTok(seg));
    } else {
      out.push(...chunkSubtitle(seg, style.maxChars ?? 40));
    }
  }
  return out;
}

function chunkTikTok(seg: TranscriptSegment): CaptionLine[] {
  const words = seg.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const totalDur = seg.end - seg.start;
  const perWord = totalDur / words.length;
  const chunks: CaptionLine[] = [];
  for (let i = 0; i < words.length; i += 2) {
    const txt = words.slice(i, i + 2).join(" ");
    const start = seg.start + i * perWord;
    const end = seg.start + Math.min((i + 2) * perWord, words.length * perWord);
    chunks.push({ start, end, text: txt });
  }
  return chunks;
}

function chunkSubtitle(seg: TranscriptSegment, maxChars: number): CaptionLine[] {
  if (seg.text.length <= maxChars) return [{ start: seg.start, end: seg.end, text: seg.text }];
  const words = seg.text.split(/\s+/).filter(Boolean);
  const totalDur = seg.end - seg.start;
  const perChar = totalDur / Math.max(seg.text.length, 1);
  const out: CaptionLine[] = [];
  let buf: string[] = [];
  let bufStart = seg.start;
  let cumChars = 0;
  for (const w of words) {
    if ((buf.join(" ") + " " + w).length > maxChars && buf.length > 0) {
      const bufEnd = bufStart + buf.join(" ").length * perChar;
      out.push({ start: bufStart, end: bufEnd, text: buf.join(" ") });
      buf = [w];
      bufStart = bufEnd;
      cumChars += w.length;
    } else {
      buf.push(w);
      cumChars += w.length + 1;
    }
  }
  if (buf.length > 0) {
    out.push({ start: bufStart, end: seg.end, text: buf.join(" ") });
  }
  return out;
}

function toSrt(lines: CaptionLine[]): string {
  return lines
    .map((ln, i) => `${i + 1}\n${ts(ln.start)} --> ${ts(ln.end)}\n${ln.text}\n`)
    .join("\n");
}

function ts(s: number): string {
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  const total = Math.floor(s);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)},${pad3(ms)}`;
}
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}
