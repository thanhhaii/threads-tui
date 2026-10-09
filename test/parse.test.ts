import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Parser, parseGraphqlBody, parsePostPage, parseThreadList } from "../src/parse.ts";
import { Store } from "../src/store.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));

describe("parseThreadList", () => {
  test.each([
    ["feed-pagination.json", 9, true],
    ["profile-ssr.json", 4, true],
    ["search-ssr.json", 20, false],
  ])("%s yields threads and pagination state", (file, threads, hasMore) => {
    const parser = new Parser();
    const r = parseThreadList(fixture(file), parser);
    expect(parser.issues).toEqual([]);
    expect(r.threads).toHaveLength(threads);
    expect(r.hasMore).toBe(hasMore);
    for (const t of r.threads) expect(t.postIds.every((id) => r.posts.some((p) => p.id === id))).toBe(true);
  });

  test("maps post fields and media kinds", () => {
    const p = parsePostPage(fixture("post-ssr.json"), new Parser()).focal!;
    expect(p).toMatchObject({
      author: { username: "sterk.acres", fullName: "Tami", verified: false },
      text: "113 ➡️ 130 lbs. \nYAY ME!",
      media: "carousel",
      mediaCount: 2,
      replyCount: 178,
      isReply: false,
      url: "https://www.threads.com/@sterk.acres/post/DeIkn4KDqLB",
    });
    const posts = parseThreadList(fixture("search-ssr.json"), new Parser()).posts;
    expect(new Set(posts.map((x) => x.media))).toEqual(new Set(["carousel", "none", "image", "video"]));
    expect(posts.find((x) => x.code === "DV6sliWjMpJ")).toMatchObject({ media: "image", mediaCount: 1 });
    // media_type 19 is a text-only post.
    expect(posts.filter((x) => x.media === "none").every((x) => x.mediaCount === 0)).toBe(true);
  });

  test("picks a ~640px preview and the largest full image, skipping square crops of portrait photos", () => {
    const cand = (w: number, h: number) => ({ url: `u${w}x${h}`, width: w, height: h });
    const p = new Parser().post(
      {
        id: "1",
        code: "c",
        user: { username: "a" },
        taken_at: 1,
        media_type: 8,
        carousel_media: [
          // Portrait photo: 3:4 versions plus square crops, like Threads serves them.
          { media_type: 1, image_versions2: { candidates: [cand(1080, 1080), cand(480, 640), cand(2316, 3088), cand(640, 640), cand(720, 960)] } },
          { media_type: 2, image_versions2: { candidates: [cand(240, 240), cand(480, 480)] } },
          { media_type: 1, image_versions2: null },
        ],
      },
      "x",
    )!;
    expect(p.images).toEqual([
      { url: "u720x960", fullUrl: "u2316x3088", width: 720, height: 960, video: false },
      { url: "u480x480", fullUrl: "u480x480", width: 480, height: 480, video: true },
    ]);
    expect(p.mediaCount).toBe(3);
  });

  test("ignores recommendation subtrees on post pages", () => {
    expect(parseThreadList(fixture("post-ssr.json"), new Parser()).threads).toEqual([]);
  });

  test("records schema failures instead of throwing", () => {
    const parser = new Parser();
    const r = parseThreadList({ data: { x: { thread_items: [{ post: { id: "1", code: "c" } }] } } }, parser);
    expect(r.threads).toEqual([]);
    expect(parser.issues).toHaveLength(1);
    expect(parser.issues[0]!.where).toBe("thread_items[0]");
  });
});

describe("reposts and quotes", () => {
  const base = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
    id,
    code: `c${id}`,
    user: { pk: id, username },
    caption: { text: `text ${id}` },
    taken_at: 1,
    text_post_app_info: extra,
  });

  test("a repost shows the original post attributed to the reposter", () => {
    const p = new Parser().post(base("1", "reposter", { share_info: { reposted_post: base("2", "author") } }), "x")!;
    expect(p).toMatchObject({ id: "2", author: { username: "author" }, text: "text 2", repostedBy: { username: "reposter" } });
  });

  test("a quote keeps the quoting post and nests the quoted one", () => {
    const p = new Parser().post(base("1", "quoter", { share_info: { quoted_post: base("2", "author") } }), "x")!;
    expect(p).toMatchObject({ id: "1", author: { username: "quoter" }, quoted: { id: "2", author: { username: "author" } } });
  });

  test("unavailable posts are dropped", () => {
    expect(new Parser().post(base("1", "a", { is_post_unavailable: true }), "x")).toBeUndefined();
  });
});

describe("reply tree", () => {
  const ROOT = "4001609338950951617_63262514180";

  test("chains nest each reply under the previous one", () => {
    const store = new Store();
    const page = parsePostPage(fixture("post-ssr.json"), new Parser());
    expect(page.focal?.code).toBe("DeIkn4KDqLB");
    store.putPostPage(page);

    const top = store.childIds(ROOT).map((id) => store.get(id)!.code);
    expect(top).toHaveLength(10);
    expect(top.slice(0, 3)).toEqual(["DeIkv4gFja6", "DeIk8VoFq4a", "DeIlCSVjR3o"]);
    expect(store.hasMoreReplies(ROOT)).toBe(true);

    // carriescubby -> sterk.acres -> carriescubby
    const c1 = store.findByCode("DeIlIHZlLNw")!;
    const c2 = store.get(store.childIds(c1.id)[0]!)!;
    expect(c2.code).toBe("DeIl6kejuRa");
    expect(store.childIds(c2.id).map((id) => store.get(id)!.code)).toEqual(["DeIl_h9lLL4"]);
  });

  test("tree rows respect expansion and flag lazily loadable replies", () => {
    const store = new Store();
    store.putPostPage(parsePostPage(fixture("post-ssr.json"), new Parser()));
    const first = store.findByCode("DeIkv4gFja6")!;
    const chained = store.findByCode("DeIlIHZlLNw")!;

    const collapsed = store.tree(ROOT, new Set());
    expect(collapsed.every((r) => r.depth === 0)).toBe(true);
    // SSR only previews part of a reply's children; the rest needs the reply's own page.
    expect(collapsed[0]).toMatchObject({ post: { id: first.id }, canLoad: true, expanded: false });

    const open = store.tree(ROOT, new Set([chained.id]));
    const at = open.findIndex((r) => r.post.id === chained.id);
    expect(open[at + 1]).toMatchObject({ depth: 1, post: { code: "DeIl6kejuRa" } });
  });

  test("a reply's own page fills in its children without duplicates", () => {
    const store = new Store();
    store.putPostPage(parsePostPage(fixture("post-ssr.json"), new Parser()));
    const parent = store.findByCode("DeIl6kejuRa")!;
    const before = store.childIds(parent.id);

    store.putPostPage(parsePostPage(fixture("reply-ssr.json"), new Parser()));
    expect(store.childIds(parent.id)).toEqual(before);
    expect(store.isLoaded(parent.id)).toBe(true);
    expect(store.tree(ROOT, new Set([parent.id])).every((r) => r.post.id !== parent.id || !r.canLoad)).toBe(true);
  });

  test("replies pagination appends to the same parent", () => {
    const store = new Store();
    store.putPostPage(parsePostPage(fixture("post-ssr.json"), new Parser()));
    store.putPostPage(parsePostPage(fixture("post-replies-xhr.json"), new Parser()));
    expect(store.childIds(ROOT)).toHaveLength(14);
  });
});

describe("parseGraphqlBody", () => {
  test("handles the for(;;) guard and streamed documents", () => {
    expect(parseGraphqlBody('for (;;);{"a":1}')).toEqual([{ a: 1 }]);
    expect(parseGraphqlBody('{"a":1}\n{"b":2}\nnot json')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(parseGraphqlBody("")).toEqual([]);
  });
});
