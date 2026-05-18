/** HTML-escape user-provided text before injecting into a composition. */
export function escapeHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * CSS-safe value escaper for things we drop into url() / font-family / colours.
 * We deliberately reject characters that could break out of the CSS context.
 */
export function escapeCss(s: string): string {
  if (!s) return "";
  // Strip newlines and quotes; collapse whitespace.
  return s.replace(/[\r\n"']/g, "").trim();
}
