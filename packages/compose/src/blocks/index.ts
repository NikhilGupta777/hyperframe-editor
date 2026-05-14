/**
 * Block registry. Every block is a pure function from typed props to an HTML fragment.
 * The builder walks the plan, picks blocks per beat, and concatenates fragments inside
 * the composition root.
 *
 * MVP ships with `HookTitle` and `EndCard`. Phase 1 extends to all 25 blocks listed in
 * PLAN.md §5.1.
 */

import { hookTitle, type HookTitleProps } from "./HookTitle.js";
import { endCard, type EndCardProps } from "./EndCard.js";

export type BlockFragment = {
  /** Inline HTML to insert inside the composition root. */
  html: string;
  /** Inline CSS the block needs (block-scoped via class names, no globals). */
  css: string;
  /** GSAP timeline JS as a string; the builder concatenates these into the main timeline. */
  js: string;
};

export type BlockRenderer<P> = (props: P) => BlockFragment;

export const BLOCKS = {
  HookTitle: hookTitle as BlockRenderer<HookTitleProps>,
  EndCard: endCard as BlockRenderer<EndCardProps>,
} as const;

export type BlockName = keyof typeof BLOCKS;

export { hookTitle, type HookTitleProps } from "./HookTitle.js";
export { endCard, type EndCardProps } from "./EndCard.js";
