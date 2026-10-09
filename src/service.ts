import type { BrowserContext } from "playwright-core";
import { isLoggedIn, launch, ORIGIN, saveDebug, Tab, type BrowserMode } from "./browser.ts";
import type { ListSource, Post, Thread } from "./model.ts";
import { Parser, parsePostPage, parseThreadList } from "./parse.ts";
import { Store } from "./store.ts";

export interface ListState {
  source: ListSource;
  threads: Thread[];
  hasMore: boolean;
}

export type Warn = (message: string) => void;

export function sourceUrl(s: ListSource): string {
  switch (s.kind) {
    case "feed":
      return `${ORIGIN}/`;
    case "profile":
      return `${ORIGIN}/@${encodeURIComponent(s.username.replace(/^@/, ""))}`;
    case "search":
      return `${ORIGIN}/search?q=${encodeURIComponent(s.query)}&serp_type=default`;
  }
}

/** Accepts a post code, a /post/<code> URL, or an @user/post/<code> URL. */
export function postCode(input: string): string {
  const m = /\/post\/([\w-]+)/.exec(input);
  return m?.[1] ?? input.trim();
}

export class ThreadsService {
  readonly store = new Store();
  private queue: Promise<unknown> = Promise.resolve();
  private listTab?: Tab;
  private postTab?: Tab;
  /** code of the post currently open in postTab */
  private postTabCode?: string;
  private list?: ListState;
  /** consecutive scrolls that produced no new threads */
  private emptyScrolls = 0;

  private constructor(
    private readonly ctx: BrowserContext,
    readonly loggedIn: boolean,
    /** Non-fatal problems (parse failures, login walls); the TUI swaps this for its status bar. */
    public warn: Warn,
  ) {}

  static async start(mode: BrowserMode, warn: Warn): Promise<ThreadsService> {
    const ctx = await launch(mode);
    // The persistent context restores a blank tab; it is never used.
    const svc = new ThreadsService(ctx, await isLoggedIn(ctx), warn);
    for (const p of ctx.pages()) await p.close();
    return svc;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    await this.ctx.close();
  }

  /** Downloads an image with the browser's cookies; independent of the page queue. */
  async fetchImage(url: string): Promise<Buffer> {
    const res = await this.ctx.request.get(url, { headers: { referer: `${ORIGIN}/` }, timeout: 20_000 });
    if (!res.ok()) throw new Error(`image HTTP ${res.status()}`);
    return res.body();
  }

  /** Browser work is strictly sequential: one page action at a time. */
  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private parser(tag: string, payloads: unknown[]): Parser & { flush(): void } {
    const parser = new Parser();
    return Object.assign(parser, {
      flush: () => {
        if (!parser.issues.length) return;
        const file = saveDebug(tag, { issues: parser.issues, payloads });
        this.warn(`${parser.issues.length} item(s) could not be parsed; raw data saved to ${file}`);
      },
    });
  }

  openList(source: ListSource): Promise<ListState> {
    return this.run(async () => {
      const threads = await this.loadListPage(source);
      // SSR pages do not always expose page_info; scrolling decides for real.
      this.list = { source, threads, hasMore: source.kind !== "search" || threads.length > 0 };
      this.emptyScrolls = 0;
      return this.list;
    });
  }

  /** Opens the list URL in a fresh-or-reused tab and returns the threads of its first page. */
  private async loadListPage(source: ListSource): Promise<Thread[]> {
    if (this.listTab?.crashed) {
      await this.listTab.close();
      this.listTab = undefined;
    }
    this.listTab ??= await Tab.open(this.ctx);
    const payloads = await this.listTab.load(sourceUrl(source), this.loggedIn, (ps) =>
      ps.some((p) => parseThreadList(p, new Parser()).threads.length > 0),
    );
    const parser = this.parser(`list-${source.kind}`, payloads);
    const threads: Thread[] = [];
    for (const payload of payloads) {
      const r = parseThreadList(payload, parser);
      this.store.putPosts(r.posts);
      threads.push(...r.threads);
    }
    parser.flush();
    if (!threads.length) {
      const file = saveDebug(`list-empty-${source.kind}`, payloads);
      this.warn(`No posts found on ${sourceUrl(source)}; page data saved to ${file}`);
    }
    return uniqueThreads(threads);
  }

  /** Scrolls the list tab and appends threads the page fetched. */
  loadMore(): Promise<ListState | undefined> {
    return this.run(async () => {
      const list = this.list;
      if (!list || !list.hasMore) return list;
      if (!this.listTab || this.listTab.crashed) {
        // The renderer died; reopen the list and scroll from its first page again.
        const reloaded = await this.loadListPage(list.source);
        this.list = { ...list, threads: uniqueThreads([...list.threads, ...reloaded]) };
      }
      const tab = this.listTab!;
      const known = new Set(this.list!.threads.map((t) => t.id));
      const payloads = await tab.scrollForMore((ps) =>
        ps.some((p) => parseThreadList(p, new Parser()).threads.some((t) => !known.has(t.id))),
      );
      const parser = this.parser(`more-${list.source.kind}`, payloads);
      const fresh: Thread[] = [];
      let endReached = false;
      for (const payload of payloads) {
        const r = parseThreadList(payload, parser);
        this.store.putPosts(r.posts);
        fresh.push(...r.threads);
        if (r.hasMore === false) endReached = true;
      }
      parser.flush();
      const threads = uniqueThreads([...this.list!.threads, ...fresh]);
      const added = threads.length - this.list!.threads.length;
      // One quiet scroll can be a slow network; two in a row means the list is exhausted.
      this.emptyScrolls = added > 0 ? 0 : this.emptyScrolls + 1;
      this.list = { source: list.source, threads, hasMore: !endReached && this.emptyScrolls < 2 };
      return this.list;
    });
  }

  /** Loads a post page (focal post + first page of replies). Cached unless `force`. */
  openPost(codeOrUrl: string, force = false): Promise<Post> {
    const code = postCode(codeOrUrl);
    return this.run(async () => {
      const cached = this.store.findByCode(code);
      if (cached && this.store.isLoaded(cached.id) && !force) return cached;
      const payloads = await this.openPostTab(code);
      const parser = this.parser(`post-${code}`, payloads);
      let focal: Post | undefined;
      for (const payload of payloads) {
        const page = parsePostPage(payload, parser);
        focal ??= page.focal;
        this.store.putPostPage(page);
      }
      parser.flush();
      if (!focal) {
        const file = saveDebug(`post-missing-${code}`, payloads);
        throw new Error(`Post ${code} not found or not readable; page data saved to ${file}`);
      }
      return focal;
    });
  }

  /** Navigates the post tab to `code`, replacing the tab if its renderer crashed. */
  private async openPostTab(code: string): Promise<unknown[]> {
    if (this.postTab?.crashed) {
      await this.postTab.close();
      this.postTab = undefined;
    }
    this.postTab ??= await Tab.open(this.ctx);
    this.postTabCode = undefined;
    const payloads = await this.postTab.load(`${ORIGIN}/post/${code}`, this.loggedIn, (ps) =>
      ps.some((p) => parsePostPage(p, new Parser()).focal),
    );
    this.postTabCode = code;
    return payloads;
  }

  /** Fetches the next page of direct replies for a post opened with openPost. */
  moreReplies(post: Post): Promise<void> {
    return this.run(async () => {
      if (!this.store.hasMoreReplies(post.id)) return;
      if (!this.postTab || this.postTab.crashed || this.postTabCode !== post.code) await this.openPostTab(post.code);
      const tab = this.postTab!;
      const before = new Set(this.store.childIds(post.id));
      const payloads = await tab.scrollForMore((ps) =>
        ps.some((p) =>
          parsePostPage(p, new Parser()).replies.some(
            (b) => b.parentId === post.id && b.chains.some((c) => !before.has(c[0]!.id)),
          ),
        ),
      );
      const parser = this.parser(`replies-${post.code}`, payloads);
      for (const payload of payloads) this.store.putPostPage(parsePostPage(payload, parser));
      parser.flush();
      if (this.store.childIds(post.id).length > before.size) return;
      // Nothing new: either the end, or Threads hides the rest from logged-out viewers.
      this.store.putPostPage({ replies: [{ parentId: post.id, chains: [], hasMore: false }], posts: [] });
      if (!this.loggedIn && (await tab.hitLoginWall())) this.warn("Threads shows more replies only to logged-in users. Run `threads login`.");
    });
  }
}

function uniqueThreads(ts: Thread[]): Thread[] {
  const seen = new Set<string>();
  return ts.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}
