/**
 * Network-capture helper for gate G7. The renderer hands us a "log" array; we
 * track every URL Chromium fetched during the render. The list lives entirely
 * in memory; we never persist it.
 *
 * For the synthetic backend we just return the empty list. For the real
 * @hyperframes/producer backend (Phase 1.5) we'll subscribe to the
 * Network.requestWillBeSent CDP event before the render starts and push every
 * URL into the same array. Either way, gate G7 receives a consistent shape.
 */
export function newNetworkLog(): string[] {
  return [];
}

export function recordRequest(log: string[], url: string): void {
  // Dedup, but keep order — the editor surfaces violations in encounter order.
  if (!log.includes(url)) log.push(url);
}
