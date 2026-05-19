/**
 * Block registry. Every block is a pure function from typed props to an HTML fragment.
 * The builder walks the plan, picks blocks per beat, and concatenates fragments inside
 * the composition root.
 *
 * MVP block library covers the V1 list in PLAN §5.1 sufficient for tiktok-hook,
 * youtube-short, devotional-reel, podcast-clip, and product-promo presets.
 */

import { hookTitle, type HookTitleProps } from "./HookTitle.js";
import { endCard, type EndCardProps } from "./EndCard.js";
import { kineticHeadline, type KineticHeadlineProps } from "./KineticHeadline.js";
import { lowerThird, type LowerThirdProps } from "./LowerThird.js";
import { captionBlock, type CaptionBlockProps } from "./CaptionBlock.js";
import { logoBug, type LogoBugProps } from "./LogoBug.js";
import { kenBurnsImage, type KenBurnsImageProps } from "./KenBurnsImage.js";
import { bRollWindow, type BRollWindowProps } from "./BRollWindow.js";
import { quoteCard, type QuoteCardProps } from "./QuoteCard.js";
import { splitScreen, type SplitScreenProps } from "./SplitScreen.js";

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
  KineticHeadline: kineticHeadline as BlockRenderer<KineticHeadlineProps>,
  LowerThird: lowerThird as BlockRenderer<LowerThirdProps>,
  CaptionBlock: captionBlock as BlockRenderer<CaptionBlockProps>,
  LogoBug: logoBug as BlockRenderer<LogoBugProps>,
  KenBurnsImage: kenBurnsImage as BlockRenderer<KenBurnsImageProps>,
  BRollWindow: bRollWindow as BlockRenderer<BRollWindowProps>,
  QuoteCard: quoteCard as BlockRenderer<QuoteCardProps>,
  SplitScreen: splitScreen as BlockRenderer<SplitScreenProps>,
} as const;

export type BlockName = keyof typeof BLOCKS;

export { hookTitle, type HookTitleProps } from "./HookTitle.js";
export { endCard, type EndCardProps } from "./EndCard.js";
export { kineticHeadline, type KineticHeadlineProps } from "./KineticHeadline.js";
export { lowerThird, type LowerThirdProps } from "./LowerThird.js";
export { captionBlock, type CaptionBlockProps } from "./CaptionBlock.js";
export { logoBug, type LogoBugProps } from "./LogoBug.js";
export { kenBurnsImage, type KenBurnsImageProps } from "./KenBurnsImage.js";
export { bRollWindow, type BRollWindowProps } from "./BRollWindow.js";
export { quoteCard, type QuoteCardProps } from "./QuoteCard.js";
export { splitScreen, type SplitScreenProps } from "./SplitScreen.js";
