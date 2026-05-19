export interface Canvas {
  width: number;
  height: number;
  fps: number;
}

export interface Clip {
  id: string;
  kind: "video" | "audio" | "image" | "block";
  block?: string;
  trackIndex: number;
  start: number;
  duration: number;
  playbackOffset?: number;
  props?: Record<string, unknown>;
}

export interface Composition {
  id: string;
  canvas: Canvas;
  duration: number;
  assets: unknown[];
  variables?: Record<string, unknown>;
  clips: Clip[];
}
