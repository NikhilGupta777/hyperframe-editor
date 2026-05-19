/**
 * Common shape across stock providers. Every provider's adapter normalises its
 * native response into a list of these so the agent can compare apples to apples.
 */
export interface StockHit {
  id: string;
  provider: "pixabay" | "unsplash" | "freepik";
  kind: "image" | "video";
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSec?: number;
  attribution: {
    provider: string;
    author?: string;
    authorUrl?: string;
    sourceUrl?: string;
    license: string;
  };
}

export interface StockSearchOptions {
  query: string;
  kind?: "image" | "video";
  perPage?: number;
  orientation?: "any" | "horizontal" | "vertical" | "square";
}
