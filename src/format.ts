import type { Post } from "./model.ts";

export function ago(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor(now / 1000 - unixSeconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function mediaTag(p: Post): string {
  switch (p.media) {
    case "image":
      return "[IMAGE]";
    case "video":
      return "[VIDEO]";
    case "carousel":
      return `[${p.mediaCount} MEDIA]`;
    case "none":
      return "";
  }
}

export function stats(p: Post): string {
  return `♥ ${compact(p.likeCount)}  💬 ${compact(p.replyCount)}  ↻ ${compact(p.repostCount)}`;
}

/** First line of a post, collapsed to one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
