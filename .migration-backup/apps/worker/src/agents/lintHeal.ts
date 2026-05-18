/**
 * Lint-and-self-heal — adapted from the Cloudflare HyperFrames template's pattern,
 * but tuned to our deterministic builder path (which shouldn't trigger lint errors)
 * and a hand-written portable lint that doesn't require pulling @hyperframes/core
 * into the worker container.
 *
 * The portable lint covers the rules we care about most for gate G2:
 *   - root has data-composition-id, data-width, data-height, data-duration
 *   - timeline registered as window.__timelines["main"]
 *   - no Math.random / Date.now / setTimeout / setInterval / repeat:-1
 *   - both the GSAP and HF runtime CDN scripts are present
 *   - every clip has class="clip" and data-start, data-duration, data-track-index
 *
 * When Phase 2 lands the LLM-driven HTML branch, the `retry` callback below will
 * call Vertex with the previous output + lint errors and return a corrected HTML.
 */

export interface LintError {
  rule: string;
  message: string;
}

export function lintHtml(html: string): LintError[] {
  const errors: LintError[] = [];
  const must = (rule: string, msg: string, ok: boolean) => {
    if (!ok) errors.push({ rule, message: msg });
  };

  must("doctype", "missing <!DOCTYPE html>", html.startsWith("<!DOCTYPE html>"));
  must(
    "root_attrs",
    "root needs data-composition-id, data-width, data-height, data-duration",
    /data-composition-id="[^"]+"/.test(html) &&
      /data-width="\d+"/.test(html) &&
      /data-height="\d+"/.test(html) &&
      /data-duration="[\d.]+"/.test(html),
  );
  must(
    "timeline_paused",
    "GSAP timeline must be created paused",
    /gsap\.timeline\(\s*\{\s*paused:\s*true/.test(html),
  );
  must(
    "timeline_registered",
    'timeline must be registered as window.__timelines["main"]',
    /window\.__timelines\["main"\]\s*=\s*tl/.test(html),
  );
  must(
    "use_fromTo",
    "use tl.fromTo, never tl.from (immediateRender breaks seeking)",
    !/[^a-zA-Z]tl\.from\(/.test(html),
  );
  must("no_math_random", "Math.random is forbidden", !/Math\.random/.test(html));
  must("no_date_now", "Date.now is forbidden", !/Date\.now/.test(html));
  must("no_settimeout", "setTimeout is forbidden", !/setTimeout\s*\(/.test(html));
  must("no_setinterval", "setInterval is forbidden", !/setInterval\s*\(/.test(html));
  must(
    "no_raf",
    "requestAnimationFrame is forbidden",
    !/requestAnimationFrame\s*\(/.test(html),
  );
  must("no_loop", "repeat:-1 (infinite loop) is forbidden", !/repeat:\s*-1/.test(html));
  must(
    "gsap_cdn",
    "GSAP CDN script tag missing",
    /cdn\.jsdelivr\.net\/npm\/gsap@/.test(html),
  );
  must(
    "hf_runtime",
    "HyperFrames runtime CDN script tag missing",
    /@hyperframes\/core\/dist\/hyperframe\.runtime\.iife\.js/.test(html),
  );

  // Per-clip checks: every element with class="clip" needs the three data attrs.
  const clipMatches = html.matchAll(/<[^>]*class="clip[^"]*"[^>]*>/g);
  let i = 0;
  for (const m of clipMatches) {
    const tag = m[0];
    if (!/data-start="[\d.]+"/.test(tag)) {
      errors.push({
        rule: "clip_data_start",
        message: `clip #${i} missing data-start`,
      });
    }
    if (!/data-duration="[\d.]+"/.test(tag)) {
      errors.push({
        rule: "clip_data_duration",
        message: `clip #${i} missing data-duration`,
      });
    }
    if (!/data-track-index="\d+"/.test(tag)) {
      errors.push({
        rule: "clip_data_track_index",
        message: `clip #${i} missing data-track-index`,
      });
    }
    i++;
  }

  return errors;
}

export interface HealOptions {
  retry: (errors: LintError[]) => Promise<string>;
  maxRetries?: number;
}

export interface HealResult {
  html: string;
  attempts: number;
  errors: LintError[];
}

export async function lintAndHeal(html: string, opts: HealOptions): Promise<HealResult> {
  const max = opts.maxRetries ?? 2;
  let cur = html;
  let errors = lintHtml(cur);
  let attempts = 1;
  while (errors.length > 0 && attempts <= max) {
    cur = await opts.retry(errors);
    errors = lintHtml(cur);
    attempts++;
  }
  return { html: cur, attempts, errors };
}
