/**
 * Type-safe wrappers around the system `ffmpeg` and `ffprobe` binaries.
 *
 * We deliberately do NOT use ffmpeg-static — it doesn't ship ARM64 reliably and we
 * already require system ffmpeg in the worker Dockerfile. If the binary is missing,
 * every function throws a clear error.
 *
 * Conventions:
 *   - all functions return promises and surface stderr on failure
 *   - paths are absolute strings (callers do their own tmp dir management)
 *   - no streaming I/O: workers operate on local files staged in tmpdir
 */
import { execa, type ExecaError } from "execa";
import { resolve } from "node:path";
import { promises as fs } from "node:fs";

export type FfmpegBin = "ffmpeg" | "ffprobe";

export const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? "ffprobe";

async function run(bin: string, args: string[], input?: Buffer): Promise<{ stdout: string; stderr: string }> {
  try {
    const r = await execa(bin, args, {
      input,
      reject: true,
      maxBuffer: 1024 * 1024 * 50, // 50 MB
    });
    return { stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const err = e as ExecaError;
    const msg = err.stderr || err.message;
    throw new Error(`${bin} failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// probe — ffprobe -show_streams + -show_format
// ---------------------------------------------------------------------------

export interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  bitrate?: number;
}

export async function probe(file: string): Promise<ProbeResult> {
  const path = resolve(file);
  const { stdout } = await run(FFPROBE_PATH, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
    format?: { duration?: string; bit_rate?: string };
  };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const fpsRaw = v?.r_frame_rate ?? v?.avg_frame_rate;
  const fps = parseFraction(fpsRaw);
  return {
    durationSec: parseFloat(j.format?.duration ?? "0"),
    width: v?.width,
    height: v?.height,
    fps,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    hasAudio: Boolean(a),
    hasVideo: Boolean(v),
    bitrate: j.format?.bit_rate ? parseInt(j.format.bit_rate, 10) : undefined,
  };
}

function parseFraction(s?: string): number | undefined {
  if (!s) return undefined;
  if (s.includes("/")) {
    const [n, d] = s.split("/").map(Number);
    if (!d) return undefined;
    return n! / d!;
  }
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : undefined;
}

// ---------------------------------------------------------------------------
// extractAudio — to 16kHz mono wav for Gemini audio understanding
// ---------------------------------------------------------------------------

export async function extractAudio(input: string, output: string): Promise<void> {
  await run(FFMPEG_PATH, [
    "-y",
    "-i",
    resolve(input),
    "-ac",
    "1",
    "-ar",
    "16000",
    "-vn",
    "-acodec",
    "pcm_s16le",
    resolve(output),
  ]);
}

// ---------------------------------------------------------------------------
// thumbnail — single-frame PNG at a timestamp
// ---------------------------------------------------------------------------

export async function thumbnail(input: string, output: string, atSec: number): Promise<void> {
  await run(FFMPEG_PATH, [
    "-y",
    "-ss",
    atSec.toFixed(3),
    "-i",
    resolve(input),
    "-frames:v",
    "1",
    "-q:v",
    "2",
    resolve(output),
  ]);
}

// ---------------------------------------------------------------------------
// volumedetect — gate G5 helper
// ---------------------------------------------------------------------------

export interface VolumeReport {
  meanVolumeDb: number;
  maxVolumeDb: number;
}

export async function volumeDetect(input: string): Promise<VolumeReport> {
  const { stderr } = await run(FFMPEG_PATH, [
    "-i",
    resolve(input),
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const mean = stderr.match(/mean_volume:\s*([-0-9.]+)\s*dB/)?.[1];
  const max = stderr.match(/max_volume:\s*([-0-9.]+)\s*dB/)?.[1];
  return {
    meanVolumeDb: mean ? parseFloat(mean) : NaN,
    maxVolumeDb: max ? parseFloat(max) : NaN,
  };
}

// ---------------------------------------------------------------------------
// loudnorm — gate G5 fix
// ---------------------------------------------------------------------------

export async function loudnorm(input: string, output: string, lufsTarget = -14): Promise<void> {
  await run(FFMPEG_PATH, [
    "-y",
    "-i",
    resolve(input),
    "-af",
    `loudnorm=I=${lufsTarget}:TP=-1.5:LRA=11`,
    "-c:v",
    "copy",
    resolve(output),
  ]);
}

// ---------------------------------------------------------------------------
// luma sampling — gate G6 helper. Uses `ffmpeg -lavfi signalstats` to read mean
// luma + stddev for one frame at a given timestamp.
// ---------------------------------------------------------------------------

export interface LumaSample {
  meanY: number; // 0..255
  stddevY: number;
}

export async function lumaAt(input: string, atSec: number): Promise<LumaSample> {
  const { stderr } = await run(FFMPEG_PATH, [
    "-ss",
    atSec.toFixed(3),
    "-i",
    resolve(input),
    "-frames:v",
    "1",
    "-vf",
    "signalstats,metadata=print",
    "-f",
    "null",
    "-",
  ]);
  const meanY = parseFloat(stderr.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)?.[1] ?? "NaN");
  const stddevY = parseFloat(stderr.match(/lavfi\.signalstats\.YDEV=([0-9.]+)/)?.[1] ?? "NaN");
  return { meanY, stddevY };
}

// ---------------------------------------------------------------------------
// playable test — gate G8: decode the first packet
// ---------------------------------------------------------------------------

export async function isPlayable(file: string): Promise<{ ok: boolean; details: string }> {
  try {
    const { stderr } = await run(FFPROBE_PATH, [
      "-v",
      "error",
      "-i",
      resolve(file),
    ]);
    if (stderr) return { ok: false, details: stderr };
    await run(FFMPEG_PATH, [
      "-v",
      "error",
      "-i",
      resolve(file),
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ]);
    return { ok: true, details: "decoded first frame" };
  } catch (e) {
    return { ok: false, details: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// silenceDetect — find silent gaps for the silence-cut tool
// ---------------------------------------------------------------------------

export interface SilenceSegment {
  start: number;
  end: number;
}

export async function silenceDetect(
  input: string,
  noiseDb = -30,
  minDurationSec = 0.5,
): Promise<SilenceSegment[]> {
  const { stderr } = await run(FFMPEG_PATH, [
    "-i",
    resolve(input),
    "-af",
    `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    "-f",
    "null",
    "-",
  ]);
  const segs: SilenceSegment[] = [];
  let curStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([0-9.]+)/);
    if (s) curStart = parseFloat(s[1]!);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (e && curStart !== null) {
      segs.push({ start: curStart, end: parseFloat(e[1]!) });
      curStart = null;
    }
  }
  return segs;
}

// ---------------------------------------------------------------------------
// caption burn-in — used by the auto-caption tool
// ---------------------------------------------------------------------------

export async function burnSubtitles(input: string, srtPath: string, output: string): Promise<void> {
  await run(FFMPEG_PATH, [
    "-y",
    "-i",
    resolve(input),
    "-vf",
    `subtitles=${resolve(srtPath).replace(/:/g, "\\:")}`,
    "-c:a",
    "copy",
    resolve(output),
  ]);
}

export async function ensureFile(path: string): Promise<void> {
  await fs.access(resolve(path));
}

export { concatCuts, type ConcatCut, type ConcatOptions } from "./concat.js";
