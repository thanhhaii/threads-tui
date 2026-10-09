import { rmSync } from "node:fs";
import { render } from "ink";
import { interactiveLogin, PROFILE_DIR, SessionError, type BrowserMode } from "./browser.ts";
import { ago, mediaTag, stats } from "./format.ts";
import type { ListSource, Post } from "./model.ts";
import { ThreadsService } from "./service.ts";
import type { Store } from "./store.ts";
import { detectGraphics } from "./terminal.ts";
import { App } from "./tui/App.tsx";
import type { ImageMode } from "./viewer.ts";

const HELP = `threads - read Threads in the terminal

Usage:
  threads [--profile <user> | --search <query>]   interactive TUI (default: home feed)
  threads login                                    log in through a Chrome window
  threads logout                                   delete the saved browser profile
  threads feed [--json] [--pages N]
  threads profile <user> [--json] [--pages N]
  threads search <query> [--json]
  threads post <code|url> [--json] [--depth N]

Options:
  --browser headless|offscreen|visible   how Chrome runs (default: headless)
  --images auto|sixel|blocks|off         how the full-screen viewer (z) draws pictures (default: auto =
                                         sixel when the terminal reports it, else colored blocks)
`;

interface Args {
  cmd: string;
  positional: string[];
  json: boolean;
  pages: number;
  depth: number;
  browser: BrowserMode;
  images: ImageMode | "auto";
  profile?: string;
  search?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: "tui", positional: [], json: false, pages: 1, depth: 2, browser: "headless", images: "auto" };
  const rest = [...argv];
  while (rest.length) {
    const t = rest.shift()!;
    const value = () => {
      const v = rest.shift();
      if (v === undefined) throw new Error(`${t} needs a value`);
      return v;
    };
    if (t === "--json") a.json = true;
    else if (t === "--pages") a.pages = Number(value());
    else if (t === "--depth") a.depth = Number(value());
    else if (t === "--browser") {
      const b = value();
      if (b !== "headless" && b !== "offscreen" && b !== "visible") throw new Error(`unknown --browser ${b}`);
      a.browser = b;
    } else if (t === "--images") {
      const m = value();
      if (m !== "auto" && m !== "sixel" && m !== "blocks" && m !== "off") throw new Error(`unknown --images ${m}`);
      a.images = m;
    } else if (t === "--profile") a.profile = value();
    else if (t === "--search") a.search = value();
    else if (t === "-h" || t === "--help") a.cmd = "help";
    else if (a.cmd === "tui" && !t.startsWith("-")) a.cmd = t;
    else a.positional.push(t);
  }
  return a;
}

function printPost(p: Post, indent = ""): void {
  const head = `${indent}@${p.author.username}${p.author.verified ? " ✓" : ""} · ${ago(p.createdAt)} · ${p.code}`;
  console.log(p.repostedBy ? `${indent}↻ reposted by @${p.repostedBy.username}\n${head}` : head);
  for (const line of p.text.split("\n")) console.log(`${indent}  ${line}`);
  const tag = mediaTag(p);
  if (tag) console.log(`${indent}  ${tag}`);
  if (p.quoted) console.log(`${indent}  ❝ @${p.quoted.author.username}: ${p.quoted.text.replace(/\s+/g, " ").slice(0, 120)}`);
  console.log(`${indent}  ${stats(p)}`);
}

interface ReplyNode extends Post {
  replies: ReplyNode[];
}

function treeJson(store: Store, id: string): ReplyNode[] {
  return store.childIds(id).flatMap((cid) => {
    const p = store.get(cid);
    return p ? [{ ...p, replies: treeJson(store, cid) }] : [];
  });
}

async function listCommand(svc: ThreadsService, source: ListSource, a: Args): Promise<void> {
  let list = await svc.openList(source);
  for (let i = 1; i < a.pages && list.hasMore; i++) list = (await svc.loadMore()) ?? list;
  const threads = list.threads.map((t) => svc.store.threadPosts(t));
  if (a.json) {
    console.log(JSON.stringify(threads, null, 2));
    return;
  }
  for (const posts of threads) {
    posts.forEach((p, i) => printPost(p, i ? "  │ " : ""));
    console.log("─".repeat(60));
  }
  console.error(`${threads.length} threads${list.hasMore ? " (more available, use --pages)" : ""}`);
}

async function postCommand(svc: ThreadsService, code: string, a: Args): Promise<void> {
  const root = await svc.openPost(code);
  // Expand deeper levels by opening each reply's own page, up to --depth.
  let frontier = [root.id];
  for (let level = 1; level < a.depth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const cid of svc.store.childIds(id)) {
        const c = svc.store.get(cid);
        if (!c) continue;
        if (c.replyCount > svc.store.childIds(cid).length && !svc.store.isLoaded(cid)) await svc.openPost(c.code);
        next.push(cid);
      }
    }
    frontier = next;
  }
  if (a.json) {
    console.log(JSON.stringify({ ...root, replies: treeJson(svc.store, root.id) }, null, 2));
    return;
  }
  printPost(root);
  console.log("═".repeat(60));
  const walk = (id: string, depth: number) => {
    for (const cid of svc.store.childIds(id)) {
      const c = svc.store.get(cid);
      if (!c) continue;
      printPost(c, "  │ ".repeat(depth));
      walk(cid, depth + 1);
    }
  };
  walk(root.id, 0);
}

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2));
  if (a.cmd === "help") {
    console.log(HELP);
    return 0;
  }
  if (a.cmd === "login") {
    console.log("A Chrome window is opening. Log in to Threads there; it closes by itself when done.");
    const user = await interactiveLogin();
    console.log(`Logged in (user id ${user}). Session saved in ${PROFILE_DIR}`);
    return 0;
  }
  if (a.cmd === "logout") {
    rmSync(PROFILE_DIR, { recursive: true, force: true });
    console.log("Browser profile deleted.");
    return 0;
  }

  const warn = (m: string) => console.error(`warning: ${m}`);
  if (a.cmd === "tui") {
    const source: ListSource = a.profile
      ? { kind: "profile", username: a.profile }
      : a.search
        ? { kind: "search", query: a.search }
        : { kind: "feed" };
    const graphics = await detectGraphics();
    const imageMode: ImageMode = a.images === "auto" ? (graphics.sixel ? "sixel" : "blocks") : a.images;
    const svc = await ThreadsService.start(a.browser, warn);
    try {
      const app = render(<App service={svc} initial={source} graphics={graphics} imageMode={imageMode} />, { alternateScreen: true });
      await app.waitUntilExit();
    } finally {
      await svc.close();
    }
    return 0;
  }

  const arg = a.positional.join(" ");
  const usage: Record<string, string> = {
    profile: "usage: threads profile <user>",
    search: "usage: threads search <query>",
    post: "usage: threads post <code|url>",
  };
  if (!["feed", "profile", "search", "post"].includes(a.cmd)) throw new Error(`unknown command ${a.cmd}\n\n${HELP}`);
  if (usage[a.cmd] && !arg) throw new Error(usage[a.cmd]);

  const svc = await ThreadsService.start(a.browser, warn);
  try {
    if (!svc.loggedIn) warn("not logged in; showing public content only. Run `threads login`.");
    if (a.cmd === "post") await postCommand(svc, arg, a);
    else
      await listCommand(
        svc,
        a.cmd === "profile" ? { kind: "profile", username: arg } : a.cmd === "search" ? { kind: "search", query: arg } : { kind: "feed" },
        a,
      );
  } finally {
    await svc.close();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof SessionError) console.error(`${err.message}. Run \`threads login\`.`);
    else console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
