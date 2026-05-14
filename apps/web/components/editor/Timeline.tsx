"use client";

import { useMemo } from "react";
import type { Composition, Clip } from "@hyperframe-editor/core";

interface Props {
  composition: Composition | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Phase-2 timeline seed: a compact strip showing every clip on every track.
 *
 * - Tracks (rows) match `data-track-index` of the composition.
 * - Each clip is positioned by `start` and sized by `duration`.
 * - Clicking a clip selects it; the editor side panel shows its props.
 *
 * Phase 3 layers drag/resize/track-move and a playhead bound to the player's
 * currentTime. The DOM here is intentionally simple so iteration is cheap.
 */
export function Timeline({ composition, selectedId, onSelect }: Props) {
  const tracks = useMemo(() => groupByTrack(composition?.clips ?? []), [composition]);
  if (!composition) {
    return <div className="text-xs opacity-60 p-3">No composition loaded.</div>;
  }
  const total = Math.max(composition.duration, 1);

  return (
    <div className="border-t border-muted/30 bg-black/30 p-3 text-xs">
      <div className="flex items-center justify-between pb-2">
        <div className="opacity-70">
          {composition.clips.length} clip{composition.clips.length === 1 ? "" : "s"} · {total.toFixed(1)}s
        </div>
        <Ruler total={total} />
      </div>
      <div className="space-y-1">
        {tracks.length === 0 ? (
          <div className="opacity-60 italic">no clips yet</div>
        ) : (
          tracks.map((track, i) => (
            <Track
              key={i}
              clips={track}
              total={total}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Ruler({ total }: { total: number }) {
  // 5 evenly spaced marker times; ceiling at the composition duration.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * total);
  return (
    <div className="flex w-1/2 justify-between text-[10px] opacity-50">
      {ticks.map((t, i) => (
        <span key={i}>{t.toFixed(1)}s</span>
      ))}
    </div>
  );
}

function Track({
  clips,
  total,
  selectedId,
  onSelect,
}: {
  clips: Clip[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="relative h-8 bg-ink/60 border border-muted/20 rounded overflow-hidden">
      {clips.map((c) => {
        const left = (c.start / total) * 100;
        const width = (c.duration / total) * 100;
        const sel = selectedId === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(sel ? null : c.id)}
            style={{ left: `${left}%`, width: `${width}%` }}
            className={`absolute top-0 bottom-0 px-1 text-left truncate border-r ${
              sel
                ? "bg-accent/35 border-accent text-paper"
                : "bg-muted/20 border-muted/40 hover:bg-muted/30"
            }`}
            title={`${c.id} (${c.kind}${c.block ? ":" + c.block : ""}) @${c.start.toFixed(2)}s for ${c.duration.toFixed(2)}s`}
          >
            <span className="font-mono opacity-80">{c.block ?? c.kind}</span>
          </button>
        );
      })}
    </div>
  );
}

function groupByTrack(clips: Clip[]): Clip[][] {
  if (clips.length === 0) return [];
  const max = clips.reduce((m, c) => Math.max(m, c.trackIndex), 0);
  const tracks: Clip[][] = Array.from({ length: max + 1 }, () => []);
  for (const c of clips) {
    tracks[c.trackIndex]?.push(c);
  }
  for (const t of tracks) t.sort((a, b) => a.start - b.start);
  return tracks;
}
