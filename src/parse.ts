import { z } from "zod";
import type { Author, MediaImage, MediaKind, ParseIssue, Post, Thread } from "./model.ts";

const UserSchema = z.object({
  id: z.string().nullish(),
  pk: z.string().nullish(),
  username: z.string(),
  full_name: z.string().nullish(),
  is_verified: z.boolean().nullish(),
});

const InfoSchema = z.object({
  is_reply: z.boolean().nullish(),
  direct_reply_count: z.number().nullish(),
  repost_count: z.number().nullish(),
  quote_count: z.number().nullish(),
  reply_to_author: z.object({ username: z.string() }).nullish(),
  share_info: z
    .object({ quoted_post: z.unknown().nullish(), reposted_post: z.unknown().nullish() })
    .nullish(),
  is_post_unavailable: z.boolean().nullish(),
});

const ImageVersionsSchema = z
  .object({ candidates: z.array(z.object({ url: z.string(), width: z.number(), height: z.number() })) })
  .nullish();

const MediaItemSchema = z.object({
  media_type: z.number().nullish(),
  image_versions2: ImageVersionsSchema,
});

const PostSchema = z.object({
  id: z.string(),
  code: z.string(),
  user: UserSchema,
  caption: z.object({ text: z.string().nullish() }).nullish(),
  taken_at: z.number(),
  like_count: z.number().nullish(),
  media_type: z.number().nullish(),
  image_versions2: ImageVersionsSchema,
  carousel_media: z.array(MediaItemSchema).nullish(),
  text_post_app_info: InfoSchema.nullish(),
});

// Big enough for a terminal render, small enough to download fast.
const PREFERRED_IMAGE_WIDTH = 640;

function pickImage(item: z.infer<typeof MediaItemSchema>): MediaImage | undefined {
  const cs = item.image_versions2?.candidates ?? [];
  if (!cs.length) return undefined;
  // Preview: smallest candidate at least the preferred width, else the largest. Full: the largest.
  // Square crops (e.g. 1080x1080 of a portrait photo) are skipped when an uncropped version exists.
  const sorted = [...cs].sort((a, b) => a.width - b.width);
  const largest = [...cs].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  const ratio = largest.width / largest.height;
  const uncropped = sorted.filter((c) => Math.abs(c.width / c.height - ratio) < 0.02);
  const pool = uncropped.length ? uncropped : sorted;
  const best = pool.find((c) => c.width >= PREFERRED_IMAGE_WIDTH) ?? pool[pool.length - 1]!;
  return { url: best.url, fullUrl: largest.url, width: best.width, height: best.height, video: item.media_type === 2 };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Subtrees Threads appends as recommendations; never part of the requested content. */
const IGNORED_KEYS: Record<string, true> = { relatedPosts: true };

function mediaKind(type: number | null | undefined): MediaKind {
  switch (type) {
    case 1:
      return "image";
    case 2:
      return "video";
    case 8:
      return "carousel";
    default:
      return "none";
  }
}

function toAuthor(u: z.infer<typeof UserSchema>): Author {
  return {
    id: u.pk ?? u.id ?? u.username,
    username: u.username,
    fullName: u.full_name ?? "",
    verified: u.is_verified ?? false,
  };
}

export class Parser {
  readonly issues: ParseIssue[] = [];

  post(raw: unknown, where: string): Post | undefined {
    const r = PostSchema.safeParse(raw);
    if (!r.success) {
      this.issues.push({ where, message: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return undefined;
    }
    const p = r.data;
    const info = p.text_post_app_info;
    if (info?.is_post_unavailable) return undefined;
    // A repost shows the original post, attributed to the reposter.
    const reposted = info?.share_info?.reposted_post
      ? this.post(info.share_info.reposted_post, `${where}.reposted`)
      : undefined;
    if (reposted) return { ...reposted, repostedBy: toAuthor(p.user) };
    return {
      id: p.id,
      code: p.code,
      url: `https://www.threads.com/@${p.user.username}/post/${p.code}`,
      author: toAuthor(p.user),
      text: p.caption?.text ?? "",
      createdAt: p.taken_at,
      likeCount: p.like_count ?? 0,
      replyCount: info?.direct_reply_count ?? 0,
      repostCount: info?.repost_count ?? 0,
      quoteCount: info?.quote_count ?? 0,
      media: mediaKind(p.media_type),
      mediaCount: p.carousel_media?.length ?? (p.media_type && p.media_type !== 19 ? 1 : 0),
      images: (p.carousel_media ?? [p]).flatMap((m) => pickImage(m) ?? []),
      isReply: info?.is_reply ?? false,
      replyTo: info?.reply_to_author?.username,
      quoted: info?.share_info?.quoted_post ? this.post(info.share_info.quoted_post, `${where}.quoted`) : undefined,
    };
  }
}

/** Every `data` object in a captured payload: SSR `__bbox.result.data` blocks or a GraphQL `{data}` body. */
export function dataRoots(payload: unknown): Json[] {
  const out: Json[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isObj(v)) return;
    const bbox = v.__bbox;
    if (isObj(bbox) && isObj(bbox.result) && isObj(bbox.result.data)) {
      out.push(bbox.result.data);
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  if (isObj(payload) && isObj(payload.data) && !("require" in payload)) out.push(payload.data);
  else walk(payload);
  return out;
}

/** Visit every object, skipping recommendation subtrees. */
function visit(root: unknown, fn: (o: Json) => boolean | void): void {
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isObj(v)) return;
    if (fn(v) === false) return;
    for (const [k, x] of Object.entries(v)) if (!IGNORED_KEYS[k]) walk(x);
  };
  walk(root);
}

export interface ThreadList {
  threads: Thread[];
  posts: Post[];
  /** undefined when the payload carried no pagination info */
  hasMore?: boolean;
}

/** Feed, profile and search payloads: every `thread_items` group becomes one Thread. */
export function parseThreadList(payload: unknown, parser: Parser): ThreadList {
  const threads: Thread[] = [];
  const seenThreads = new Set<string>();
  const posts: Post[] = [];
  let hasMore: boolean | undefined;
  for (const root of dataRoots(payload)) {
    visit(root, (o) => {
      if (Array.isArray(o.edges) && isObj(o.page_info) && o.edges.some(edgeHasThread)) {
        hasMore = (hasMore ?? false) || o.page_info.has_next_page === true;
      }
      if (!Array.isArray(o.thread_items)) return;
      const ids: string[] = [];
      o.thread_items.forEach((item, i) => {
        const p = isObj(item) ? parser.post(item.post, `thread_items[${i}]`) : undefined;
        if (!p) return;
        posts.push(p);
        ids.push(p.id);
      });
      const id = typeof o.id === "string" ? o.id : ids[0];
      if (id && !seenThreads.has(id)) {
        seenThreads.add(id);
        threads.push({ id, postIds: ids });
      }
      return false;
    });
  }
  return { threads, posts, hasMore };
}

function edgeHasThread(e: unknown): boolean {
  if (!isObj(e)) return false;
  const n = e.node;
  return (
    isObj(e.text_post_app_thread) ||
    (isObj(n) && (Array.isArray(n.thread_items) || isObj(n.thread)))
  );
}

export interface ReplyBlock {
  /** media id of the post these replies answer */
  parentId: string;
  /** each chain: [0] answers parent, [n] answers [n-1] */
  chains: Post[][];
  hasMore: boolean;
}

export interface PostPage {
  focal?: Post;
  replies: ReplyBlock[];
  posts: Post[];
}

/** Post page payloads (SSR or replies pagination). */
export function parsePostPage(payload: unknown, parser: Parser): PostPage {
  const page: PostPage = { replies: [], posts: [] };
  for (const root of dataRoots(payload)) {
    const media = root.media;
    if (isObj(media) && typeof media.code === "string" && !page.focal) {
      page.focal = parser.post(media, "media");
      if (page.focal) page.posts.push(page.focal);
    }
    visit(root, (o) => {
      const info = o.text_post_app_info;
      if (typeof o.id !== "string" || !isObj(info) || !isObj(info.direct_replies)) return;
      const dr = info.direct_replies;
      const chains: Post[][] = [];
      for (const edge of Array.isArray(dr.edges) ? dr.edges : []) {
        const view = isObj(edge) ? edge.node : undefined;
        const items = isObj(view) && isObj(view.posts) && Array.isArray(view.posts.edges) ? view.posts.edges : [];
        const chain: Post[] = [];
        for (const [i, pe] of items.entries()) {
          const p = isObj(pe) ? parser.post(pe.node, `direct_replies.posts[${i}]`) : undefined;
          if (!p) break;
          chain.push(p);
        }
        if (chain.length) {
          chains.push(chain);
          page.posts.push(...chain);
        }
      }
      const pi = dr.page_info;
      page.replies.push({ parentId: o.id, chains, hasMore: isObj(pi) && pi.has_next_page === true });
      return false;
    });
  }
  return page;
}

/** GraphQL bodies may be prefixed and/or streamed as newline-separated JSON documents. */
export function parseGraphqlBody(text: string): unknown[] {
  const clean = text.replace(/^for \(;;\);/, "").trim();
  if (!clean) return [];
  try {
    return [JSON.parse(clean)];
  } catch {
    return clean
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  }
}
