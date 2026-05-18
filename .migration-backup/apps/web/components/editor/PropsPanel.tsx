"use client";

import { useMemo } from "react";
import type { Composition, Clip } from "@hyperframe-editor/core";

interface Props {
  composition: Composition | null;
  selectedId: string | null;
  onChange: (next: Composition) => void;
  onDelete?: (clipId: string) => void;
}

/**
 * Props panel — shows the selected clip's metadata + the few props we know how
 * to safely edit inline. Anything more elaborate (per-block prop schemas) lives
 * in Phase 4 once we wire reflection on each block's prop type.
 */
export function PropsPanel({ composition, selectedId, onChange, onDelete }: Props) {
  const clip = useMemo<Clip | null>(() => {
    if (!composition || !selectedId) return null;
    return composition.clips.find((c) => c.id === selectedId) ?? null;
  }, [composition, selectedId]);

  if (!clip || !composition) {
    return (
      <div className="text-xs opacity-50 p-3">
        Select a clip in the timeline to inspect.
      </div>
    );
  }

  function patch(p: Partial<Clip>) {
    if (!composition || !clip) return;
    const next: Composition = JSON.parse(JSON.stringify(composition));
    const idx = next.clips.findIndex((c) => c.id === clip.id);
    if (idx < 0) return;
    next.clips[idx] = { ...next.clips[idx]!, ...p };
    next.duration = next.clips.reduce(
      (m, c) => Math.max(m, c.start + c.duration),
      0,
    );
    onChange(next);
  }

  function patchProp(key: string, value: unknown) {
    if (!clip) return;
    patch({ props: { ...clip.props, [key]: value } });
  }

  const props = clip.props as Record<string, unknown>;

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono opacity-70">{clip.id}</div>
          <div className="opacity-50">
            {clip.kind}
            {clip.block ? `:${clip.block}` : ""}
          </div>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(clip.id)}
            className="text-red-300 hover:text-red-200 text-[11px]"
          >
            delete
          </button>
        )}
      </div>

      <Field label="start (s)">
        <NumberInput
          value={clip.start}
          onChange={(v) => patch({ start: v })}
          min={0}
          step={0.05}
        />
      </Field>
      <Field label="duration (s)">
        <NumberInput
          value={clip.duration}
          onChange={(v) => patch({ duration: Math.max(0.1, v) })}
          min={0.1}
          step={0.05}
        />
      </Field>
      <Field label="track">
        <NumberInput
          value={clip.trackIndex}
          onChange={(v) => patch({ trackIndex: Math.max(0, v | 0) })}
          min={0}
          step={1}
        />
      </Field>
      {(clip.kind === "video" || clip.kind === "audio") && (
        <Field label="playback offset (s)">
          <NumberInput
            value={clip.playbackOffset ?? 0}
            onChange={(v) => patch({ playbackOffset: Math.max(0, v) })}
            min={0}
            step={0.05}
          />
        </Field>
      )}

      {clip.kind === "block" && Object.keys(props).length > 0 && (
        <div className="border-t border-muted/30 pt-2 space-y-2">
          <div className="opacity-60">props</div>
          {Object.entries(props).map(([k, v]) =>
            typeof v === "string" ? (
              <Field key={k} label={k}>
                <input
                  value={v}
                  onChange={(e) => patchProp(k, e.target.value)}
                  className="w-full rounded bg-ink/60 border border-muted/40 px-2 py-1"
                />
              </Field>
            ) : typeof v === "number" ? (
              <Field key={k} label={k}>
                <NumberInput
                  value={v}
                  onChange={(n) => patchProp(k, n)}
                  step={0.1}
                />
              </Field>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block opacity-60 pb-1">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      step={step ?? 0.1}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="w-full rounded bg-ink/60 border border-muted/40 px-2 py-1"
    />
  );
}
