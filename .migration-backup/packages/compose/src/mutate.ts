/**
 * Composition mutation helpers — pure (composition, args) → composition
 * transformations. Safe to import from both the worker and the web app
 * because they have no Node-only dependencies.
 *
 * Originally lived in apps/worker/src/tools/composition.ts; moved here so the
 * web app's API routes can import them through a normal workspace path.
 */
import {
  type Composition,
  CompositionSchema,
  type Clip,
  computeDuration,
} from "@hyperframe-editor/core";

export interface MoveClipArgs {
  clipId: string;
  start?: number;
  trackIndex?: number;
}
export interface TrimClipArgs {
  clipId: string;
  duration?: number;
  playbackOffset?: number;
}
export interface AddClipArgs {
  start?: number;
  trackIndex?: number;
  clip: Partial<Clip> & { kind: Clip["kind"]; duration: number };
}
export interface DeleteClipArgs {
  clipId: string;
}
export interface SetCompositionMetaArgs {
  width?: number;
  height?: number;
  fps?: number;
  variables?: Record<string, unknown>;
}

function clone(c: Composition): Composition {
  return JSON.parse(JSON.stringify(c)) as Composition;
}

export function moveClip(comp: Composition, args: MoveClipArgs): Composition {
  const next = clone(comp);
  const clip = next.clips.find((c) => c.id === args.clipId);
  if (!clip) throw new Error(`unknown clip: ${args.clipId}`);
  if (args.start !== undefined) clip.start = Math.max(0, Number(args.start.toFixed(3)));
  if (args.trackIndex !== undefined) clip.trackIndex = Math.max(0, args.trackIndex | 0);
  next.duration = computeDuration(next);
  return CompositionSchema.parse(next);
}

export function trimClip(comp: Composition, args: TrimClipArgs): Composition {
  const next = clone(comp);
  const clip = next.clips.find((c) => c.id === args.clipId);
  if (!clip) throw new Error(`unknown clip: ${args.clipId}`);
  if (args.duration !== undefined) {
    clip.duration = Math.max(0.1, Number(args.duration.toFixed(3)));
  }
  if (args.playbackOffset !== undefined) {
    clip.playbackOffset = Math.max(0, Number(args.playbackOffset.toFixed(3)));
  }
  next.duration = computeDuration(next);
  return CompositionSchema.parse(next);
}

export function addClip(comp: Composition, args: AddClipArgs): Composition {
  const next = clone(comp);
  const trackIndex = args.trackIndex ?? 0;
  const start =
    args.start ??
    next.clips
      .filter((c) => c.trackIndex === trackIndex)
      .reduce((m, c) => Math.max(m, c.start + c.duration), 0);

  const id = args.clip.id ?? `clip-${Math.random().toString(36).slice(2, 8)}`;
  const newClip: Clip = {
    id,
    kind: args.clip.kind,
    trackIndex,
    start,
    duration: args.clip.duration,
    playbackOffset: args.clip.playbackOffset ?? 0,
    block: args.clip.block,
    assetId: args.clip.assetId,
    props: args.clip.props ?? {},
  };
  next.clips.push(newClip);
  next.duration = computeDuration(next);
  return CompositionSchema.parse(next);
}

export function deleteClip(comp: Composition, args: DeleteClipArgs): Composition {
  const next = clone(comp);
  next.clips = next.clips.filter((c) => c.id !== args.clipId);
  next.duration = computeDuration(next);
  return CompositionSchema.parse(next);
}

export function setCompositionMeta(
  comp: Composition,
  args: SetCompositionMetaArgs,
): Composition {
  const next = clone(comp);
  if (args.width !== undefined) next.canvas.width = args.width;
  if (args.height !== undefined) next.canvas.height = args.height;
  if (args.fps !== undefined) next.canvas.fps = args.fps;
  if (args.variables) next.variables = { ...next.variables, ...args.variables };
  return CompositionSchema.parse(next);
}

export function setTrackOrder(
  comp: Composition,
  args: { trackIndex: number; orderedClipIds: string[] },
): Composition {
  const next = clone(comp);
  // Reorder by re-inserting clips in the requested order. Track-mate clips at
  // unspecified ids keep their relative order at the end.
  const onTrack = next.clips.filter((c) => c.trackIndex === args.trackIndex);
  const offTrack = next.clips.filter((c) => c.trackIndex !== args.trackIndex);
  const ordered: typeof onTrack = [];
  for (const id of args.orderedClipIds) {
    const found = onTrack.find((c) => c.id === id);
    if (found) ordered.push(found);
  }
  for (const c of onTrack) {
    if (!ordered.includes(c)) ordered.push(c);
  }
  next.clips = [...ordered, ...offTrack];
  return CompositionSchema.parse(next);
}
