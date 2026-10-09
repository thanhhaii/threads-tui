import { ago, mediaTag, oneLine, stats } from "../format.ts";
import type { ImageRow } from "../image.ts";
import type { Post } from "../model.ts";
import type { Line } from "./ScrollList.tsx";
import { thumbnails } from "./thumbnails.ts";

/** Size of inline pictures under a post, in terminal cells. */
export interface ThumbSize {
  cols: number;
  rows: number;
}

// Carousels show up to this many pictures side by side.
const MAX_SIDE_BY_SIDE = 3;
const GAP = 1;

/** Lines for a post's pictures: real cells when loaded, a placeholder box otherwise. */
function imageLines(p: Post, size: ThumbSize): Line[] {
  const imgs = p.images.slice(0, MAX_SIDE_BY_SIDE);
  if (!imgs.length) return [];
  // Each picture gets an equal slot; one picture may use the whole width.
  const slot = Math.max(8, Math.floor((size.cols - GAP * (imgs.length - 1)) / imgs.length));
  const states = imgs.map((img) => thumbnails.get(img, slot, size.rows));
  if (states.some((s) => s.status === "loading")) return [{ text: `[loading ${imgs.length > 1 ? `${imgs.length} images` : "image"}…]`, dim: true }];
  const ready = states.flatMap((s) => (s.status === "ready" ? [s.rows] : []));
  if (!ready.length) return [{ text: mediaTag(p) + " (preview failed)", color: "blue" }];
  const height = Math.max(...ready.map((r) => r.length));
  const blank = { fg: "#000000", bg: "#000000" };
  const lines: Line[] = [];
  for (let y = 0; y < height; y++) {
    const row: ImageRow = [];
    ready.forEach((pic, i) => {
      const width = pic[0]?.length ?? 0;
      // Pad shorter pictures with transparent-looking gaps so columns stay aligned.
      const cells = pic[y] ?? [];
      row.push(...cells, ...Array.from({ length: width - cells.length }, () => blank));
      if (i < ready.length - 1) row.push(...Array.from({ length: GAP }, () => blank));
    });
    lines.push({ text: "", cells: row });
  }
  return lines;
}

/** Lines for one post card; `maxTextLines` truncates long bodies in lists; `thumb` adds inline pictures. */
export function postLines(p: Post, opts: { maxTextLines?: number; note?: string; thumb?: ThumbSize } = {}): Line[] {
  const lines: Line[] = [];
  if (p.repostedBy) lines.push({ text: `↻ @${p.repostedBy.username} reposted`, dim: true });
  const reply = p.replyTo ? ` → @${p.replyTo}` : "";
  lines.push({
    text: `@${p.author.username}${p.author.verified ? " ✓" : ""}${reply} · ${ago(p.createdAt)}`,
    bold: true,
    color: "white",
  });
  const body = p.text.split("\n");
  const max = opts.maxTextLines ?? Infinity;
  for (const l of body.slice(0, max)) lines.push({ text: l });
  if (body.length > max) lines.push({ text: "…", dim: true });
  const tag = mediaTag(p);
  if (opts.thumb && p.images.length) {
    lines.push(...imageLines(p, opts.thumb));
    if (p.images.length > MAX_SIDE_BY_SIDE || p.media === "video") lines.push({ text: tag, color: "blue" });
  } else if (tag) lines.push({ text: tag, color: "blue" });
  if (p.quoted) lines.push({ text: `❝ @${p.quoted.author.username}: ${oneLine(p.quoted.text).slice(0, 200)}`, color: "gray" });
  lines.push({ text: stats(p) + (opts.note ? `  ${opts.note}` : ""), dim: true });
  return lines;
}
