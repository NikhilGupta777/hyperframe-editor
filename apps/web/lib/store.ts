/**
 * Minimal client store. Holds the composition AST, agent stream, current
 * job-id, and any source uploads. Heavy lifting (timeline interactions, asset
 * drawer) lands in Phase 3 — this is the seed.
 */
"use client";

import { create } from "zustand";
import type { Composition } from "@hyperframe-editor/core";

type AgentEvent =
  | { type: "step"; step: string; status: "running" | "succeeded" | "failed" }
  | { type: "log"; level: "info" | "warn" | "error"; msg: string }
  | { type: "tool"; name: string; input?: unknown; output?: unknown }
  | { type: "progress"; pct: number; frame?: number; total?: number }
  | {
      type: "gate";
      id: string;
      pass: boolean;
      severity: "block" | "warn";
      details?: unknown;
      fix?: string;
    }
  | { type: "done"; url?: string; gates?: Record<string, "pass" | "warn" | "fail"> }
  | { type: "error"; message: string };

interface SourceLike {
  id: string;
  kind: "video" | "audio" | "image";
  storageUri: string;
  filename: string;
}

export interface EditorState {
  projectId: string | null;
  composition: Composition | null;
  events: AgentEvent[];
  currentJobId: string | null;
  doneUrl: string | null;
  sources: SourceLike[];

  setProjectId(id: string): void;
  setComposition(c: Composition | null): void;
  appendEvent(e: AgentEvent): void;
  resetEvents(): void;
  setCurrentJob(id: string | null): void;
  setDoneUrl(url: string | null): void;
  addSource(s: SourceLike): void;
}

export const useEditor = create<EditorState>((set) => ({
  projectId: null,
  composition: null,
  events: [],
  currentJobId: null,
  doneUrl: null,
  sources: [],
  setProjectId: (id) => set({ projectId: id }),
  setComposition: (c) => set({ composition: c }),
  appendEvent: (e) =>
    set((state) => ({
      events: [...state.events, e],
      ...(e.type === "done" && e.url ? { doneUrl: e.url } : {}),
    })),
  resetEvents: () => set({ events: [], doneUrl: null }),
  setCurrentJob: (id) => set({ currentJobId: id }),
  setDoneUrl: (url) => set({ doneUrl: url }),
  addSource: (s) => set((state) => ({ sources: [...state.sources, s] })),
}));
