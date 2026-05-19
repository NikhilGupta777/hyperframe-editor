import { useMemo, useRef, useState } from "react";
import type { Composition, Clip } from "@/types/composition";

interface Props {
  composition: Composition | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMutate?: (next: Composition) => void;
}

type DragState =
  | null
  | { kind: "move"; clipId: string; startTime: number; pointerStart: number }
  | { kind: "resize"; clipId: string; edge: "left" | "right"; pointerStart: number; original: Clip };

export function Timeline({ composition, selectedId, onSelect, onMutate }: Props) {
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);

  const tracks = useMemo(() => groupByTrack(composition?.clips ?? []), [composition]);
  if (!composition) {
    return <div className="text-xs opacity-60 p-3">No composition loaded.</div>;
  }
  const total = Math.max(composition.duration, 1);

  function pxToTime(px: number): number {
    const firstTrack = trackContainerRef.current?.querySelector("[data-track-row]");
    const rect =
      (firstTrack as HTMLElement | null)?.getBoundingClientRect() ??
      trackContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return (px / rect.width) * total;
  }

  function startMove(e: React.PointerEvent, clip: Clip) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({
      kind: "move",
      clipId: clip.id,
      startTime: clip.start,
      pointerStart: e.clientX,
    });
  }
  function startResize(e: React.PointerEvent, clip: Clip, edge: "left" | "right") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ kind: "resize", clipId: clip.id, edge, pointerStart: e.clientX, original: clip });
  }
  function onMove(e: React.PointerEvent) {
    if (!drag || !composition || !onMutate) return;
    const dxPx = e.clientX - drag.pointerStart;
    const dt = pxToTime(dxPx);
    const next = JSON.parse(JSON.stringify(composition)) as Composition;
    const clip = next.clips.find((c) => c.id === drag.clipId);
    if (!clip) return;
    if (drag.kind === "move") {
      clip.start = Math.max(0, Number((drag.startTime + dt).toFixed(3)));
    } else {
      const o = drag.original;
      if (drag.edge === "right") {
        clip.duration = Math.max(0.1, Number((o.duration + dt).toFixed(3)));
      } else {
        const newStart = Math.max(0, Number((o.start + dt).toFixed(3)));
        const delta = newStart - o.start;
        clip.start = newStart;
        clip.duration = Math.max(0.1, Number((o.duration - delta).toFixed(3)));
        if (clip.kind === "video" || clip.kind === "audio") {
          clip.playbackOffset = Math.max(0, Number(((o.playbackOffset ?? 0) + delta).toFixed(3)));
        }
      }
    }
    next.duration = next.clips.reduce(
      (m, c) => Math.max(m, c.start + c.duration),
      0,
    );
    onMutate(next);
  }
  function onUp(e: React.PointerEvent) {
    if (drag) (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDrag(null);
  }

  return (
    <div className="border-t border-muted/30 bg-black/30 p-3 text-xs">
      <div className="flex items-center justify-between pb-2">
        <div className="opacity-70">
          {composition.clips.length} clip{composition.clips.length === 1 ? "" : "s"} ·{" "}
          {total.toFixed(1)}s
        </div>
      </div>
      <Ruler total={total} />
      <div
        ref={trackContainerRef}
        className="space-y-1.5 select-none touch-none"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
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
              onMoveStart={startMove}
              onResizeStart={startResize}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Ruler({ total }: { total: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => p * total);
  return (
    <div className="flex w-full justify-between text-[10px] opacity-50 pb-1">
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
  onMoveStart,
  onResizeStart,
}: {
  clips: Clip[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveStart: (e: React.PointerEvent, clip: Clip) => void;
  onResizeStart: (e: React.PointerEvent, clip: Clip, edge: "left" | "right") => void;
}) {
  return (
    <div
      data-track-row
      className="relative h-11 bg-ink/60 border border-muted/20 rounded overflow-hidden"
    >
      {clips.map((c) => {
        const left = (c.start / total) * 100;
        const width = (c.duration / total) * 100;
        const sel = selectedId === c.id;
        return (
          <div
            key={c.id}
            style={{ left: `${left}%`, width: `${width}%` }}
            className={`absolute top-0 bottom-0 ${
              sel
                ? "bg-accent/40 border-y border-accent text-paper"
                : "bg-muted/25 hover:bg-muted/40 border-y border-muted/40"
            }`}
            onClick={() => onSelect(sel ? null : c.id)}
            title={`${c.id} (${c.kind}${c.block ? ":" + c.block : ""})`}
          >
            {/* Left resize handle — wider touch target */}
            <button
              onPointerDown={(e) => startResizeIfNotMove(e, c, "left", onResizeStart)}
              className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize z-10 flex items-center justify-start"
              aria-label="resize-left"
              type="button"
            >
              <span className="w-1 h-full bg-accent/0 hover:bg-accent/60 transition-colors" />
            </button>

            {/* Move handle */}
            <button
              onPointerDown={(e) => onMoveStart(e, c)}
              className="absolute inset-0 cursor-grab active:cursor-grabbing px-4 text-left truncate"
              type="button"
            >
              <span className="font-mono opacity-80 text-[10px]">{c.block ?? c.kind}</span>
            </button>

            {/* Right resize handle — wider touch target */}
            <button
              onPointerDown={(e) => startResizeIfNotMove(e, c, "right", onResizeStart)}
              className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize z-10 flex items-center justify-end"
              aria-label="resize-right"
              type="button"
            >
              <span className="w-1 h-full bg-accent/0 hover:bg-accent/60 transition-colors" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function startResizeIfNotMove(
  e: React.PointerEvent,
  clip: Clip,
  edge: "left" | "right",
  onResizeStart: (e: React.PointerEvent, clip: Clip, edge: "left" | "right") => void,
) {
  e.stopPropagation();
  onResizeStart(e, clip, edge);
}

function groupByTrack(clips: Clip[]): Clip[][] {
  if (clips.length === 0) return [];
  const max = clips.reduce((m, c) => Math.max(m, c.trackIndex), 0);
  const tracks: Clip[][] = Array.from({ length: max + 1 }, () => []);
  for (const c of clips) tracks[c.trackIndex]?.push(c);
  for (const t of tracks) t.sort((a, b) => a.start - b.start);
  return tracks;
}
