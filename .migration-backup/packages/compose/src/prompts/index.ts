/**
 * Prompts the agent uses to drive Vertex AI Gemini 3.1 Pro.
 *
 * The composition system prompt is adapted from the Cloudflare HyperFrames
 * template's `hyperframes-skill.ts` — it's the gold-standard prompt for getting
 * a model to produce HyperFrames-valid HTML on the first or second try.
 *
 * The knowledge base consolidates ALL official HyperFrames documentation into
 * a single injectable context the agent can reference during composition.
 */
export { COMPOSITION_SYSTEM_PROMPT } from "./composition.js";
export { STORYBOARD_SYSTEM_PROMPT } from "./storyboard.js";
export { FULL_HYPERFRAMES_KNOWLEDGE } from "./hyperframes-knowledge.js";
