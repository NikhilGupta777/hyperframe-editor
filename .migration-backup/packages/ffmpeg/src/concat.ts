/**
 * ffmpeg-driven EDL concatenation.
 *
 * Given a list of `{src, in, out}` cuts, produce a single contiguous MP4. We
 * use the filter_complex `concat` filter which preserves frame-accurate cuts
 * and re-encodes once (slower but reliable across mixed codecs / fps / sizes).
 *
 * Limitations of the simpler `-f concat` demuxer:
 *   - requires identical streams across all inputs
 *   - chokes on differing fps or codec
 *
 * The filter_complex path is the one that actually works for arbitrary EDLs.
 */
import { resolve } from "node:path";
import { execa } from "execa";
import { FFMPEG_PATH } from "./index.js";

export interface ConcatCut {
  src: string;
  /** Source-time start of the cut, seconds. */
  in: number;
  /** Source-time end of the cut, seconds. */
  out: number;
  /** Optional speed multiplier; 1.0 = native. */
  speed?: number;
}

export interface ConcatOptions {
  width: number;
  height: number;
  fps: number;
  /** If false, skip audio entirely. */
  audio?: boolean;
}

/**
 * Concatenate EDL cuts into `output`. Audio and video are re-encoded so the
 * result has a single consistent stream profile, regardless of source variance.
 */
export async function concatCuts(
  cuts: ConcatCut[],
  output: string,
  opts: ConcatOptions,
): Promise<void> {
  if (cuts.length === 0) throw new Error("concatCuts: no cuts supplied");
  const audio = opts.audio !== false;

  // Build a filter_complex graph:
  //   [0:v]trim=in:out,setpts=PTS-STARTPTS,scale=w:h,setsar=1[v0];
  //   [0:a]atrim=in:out,asetpts=PTS-STARTPTS[a0];
  //   ...
  //   [v0][a0][v1][a1]...concat=n=N:v=1:a=1[outv][outa]
  const inputs: string[] = [];
  const filters: string[] = [];
  cuts.forEach((cut, i) => {
    inputs.push("-i", resolve(cut.src));
    const speed = Math.max(0.1, cut.speed ?? 1);
    filters.push(
      `[${i}:v]trim=${cut.in.toFixed(3)}:${cut.out.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(3)},fps=${opts.fps},scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`,
    );
    if (audio) {
      // atempo only handles 0.5..2.0 in one pass; for typical EDL values that's plenty.
      const tempo = Math.max(0.5, Math.min(2, speed));
      filters.push(
        `[${i}:a]atrim=${cut.in.toFixed(3)}:${cut.out.toFixed(3)},asetpts=PTS-STARTPTS,atempo=${tempo.toFixed(3)},aresample=44100[a${i}]`,
      );
    }
  });
  const concatInputs = cuts
    .map((_, i) => (audio ? `[v${i}][a${i}]` : `[v${i}]`))
    .join("");
  filters.push(
    `${concatInputs}concat=n=${cuts.length}:v=1:a=${audio ? 1 : 0}[outv]${audio ? "[outa]" : ""}`,
  );

  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
    ...(audio ? ["-map", "[outa]"] : []),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    ...(audio
      ? ["-c:a", "aac", "-b:a", "128k"]
      : ["-an"]),
    resolve(output),
  ];
  await execa(FFMPEG_PATH, args, { reject: true });
}
