import { chromium, type BrowserContext, type Page, type Response } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseGraphqlBody } from "./parse.ts";

export type BrowserMode = "headless" | "offscreen" | "visible";

export const APP_DIR = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? ".", ".local", "share"), "threads-tui");
// Keeps Chrome's HTTP cache in the profile small.
const DISK_CACHE_BYTES = 50 * 1024 * 1024;
export const PROFILE_DIR = join(APP_DIR, "profile");
export const DEBUG_DIR = join(APP_DIR, "debug");
export const ORIGIN = "https://www.threads.com";

export class SessionError extends Error {}

export async function launch(mode: BrowserMode): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: mode === "headless",
      viewport: { width: 1200, height: 900 },
      args: [`--disk-cache-size=${DISK_CACHE_BYTES}`, ...(mode === "offscreen" ? ["--window-position=-32000,-32000"] : [])],
    });
  } catch (e) {
    // Chrome exits with code 21 when another instance holds the profile lock.
    if (e instanceof Error && /exitCode=21/.test(e.message))
      throw new Error("Another threads-tui (or its Chrome) is already running. Close it first.");
    throw e;
  }
}

export async function isLoggedIn(ctx: BrowserContext): Promise<boolean> {
  const cookies = await ctx.cookies(ORIGIN);
  return cookies.some((c) => c.name === "sessionid" && c.value !== "");
}

/** Opens a visible window and waits until the user finishes logging in. */
export async function interactiveLogin(timeoutMs = 600_000): Promise<string> {
  const ctx = await launch("visible");
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${ORIGIN}/login`, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + timeoutMs;
    while (!(await isLoggedIn(ctx))) {
      if (Date.now() > deadline) throw new SessionError("Login timed out");
      await page.waitForTimeout(1000);
    }
    const user = (await ctx.cookies(ORIGIN)).find((c) => c.name === "ds_user_id")?.value ?? "";
    return user;
  } finally {
    await ctx.close();
  }
}

export function saveDebug(tag: string, body: unknown): string {
  mkdirSync(DEBUG_DIR, { recursive: true });
  const file = join(DEBUG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${tag.replace(/[^\w.-]+/g, "_")}.json`);
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  return file;
}

const BLOCKED_TYPES: Record<string, true> = { image: true, media: true, font: true };
const BLOCKED_PATHS = /\/(login|accounts\/login|challenge|checkpoint|accounts\/suspended)/;

interface Captured {
  name: string;
  payloads: unknown[];
}

/** One browser tab that remembers every GraphQL response it received. */
export class Tab {
  private readonly captured: Captured[] = [];
  private waiters: (() => void)[] = [];
  /** Set when Chrome kills the renderer; the tab must be replaced. */
  crashed = false;

  private constructor(readonly page: Page) {}

  static async open(ctx: BrowserContext): Promise<Tab> {
    const page = await ctx.newPage();
    await page.route("**/*", (route) =>
      BLOCKED_TYPES[route.request().resourceType()] ? route.abort() : route.continue(),
    );
    const tab = new Tab(page);
    page.on("response", (res) => void tab.onResponse(res));
    page.on("crash", () => {
      tab.crashed = true;
    });
    return tab;
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined);
  }

  private async onResponse(res: Response): Promise<void> {
    if (!res.url().includes("/graphql")) return;
    const name = res.request().headers()["x-fb-friendly-name"] ?? "unknown";
    // Experiment flags carry no content.
    if (name.startsWith("fetchBarcelonaExperiment")) return;
    const text = await res.text().catch(() => "");
    this.captured.push({ name, payloads: parseGraphqlBody(text) });
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w());
  }

  /**
   * Navigate and gather page data until `ready` accepts it. Threads sometimes server-renders the first page
   * and sometimes fetches it with GraphQL right after load, so both sources are checked.
   * Throws SessionError when Threads bounces to login/checkpoint.
   */
  async load(url: string, expectLoggedIn: boolean, ready: (payloads: unknown[]) => boolean, timeoutMs = 15_000): Promise<unknown[]> {
    await sleep(300 + Math.random() * 600); // human-like pacing
    this.captured.length = 0;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    const path = new URL(this.page.url()).pathname;
    if (BLOCKED_PATHS.test(path)) {
      throw new SessionError(
        expectLoggedIn ? "Threads asked to log in again (session expired or checkpoint)" : "Threads requires login for this page",
      );
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const payloads = [...(await this.embedded()), ...this.captured.flatMap((c) => c.payloads)];
      if (ready(payloads) || Date.now() >= deadline) return payloads;
      await this.nextResponse(Math.min(500, deadline - Date.now()));
    }
  }

  private nextResponse(timeoutMs: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(resolve, Math.max(0, timeoutMs));
    this.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
    return promise;
  }

  get url(): string {
    return this.page.url();
  }

  async embedded(): Promise<unknown[]> {
    const texts = await this.page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent ?? ""));
    return texts.flatMap((t) => {
      if (!t.includes("__bbox")) return [];
      try {
        return [JSON.parse(t)];
      } catch {
        return [];
      }
    });
  }

  /** Logged-out viewers get an inline "Log in to see more" wall instead of more data. */
  async hitLoginWall(): Promise<boolean> {
    return (await this.page.getByText(/Log in to see more/i).count()) > 0;
  }

  /**
   * Scroll to the bottom and collect GraphQL payloads until `ready` accepts them or `timeoutMs` passes.
   * Many unrelated queries fire on scroll, so the caller decides what counts as new content.
   */
  async scrollForMore(ready: (payloads: unknown[]) => boolean, timeoutMs = 10_000): Promise<unknown[]> {
    await sleep(300 + Math.random() * 600); // human-like pacing
    const start = this.captured.length;
    await this.page.mouse.wheel(0, 20_000);
    await this.page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const payloads = this.captured.slice(start).flatMap((c) => c.payloads);
      if (ready(payloads)) {
        // Streamed queries may send follow-up chunks right after the first.
        await this.page.waitForTimeout(400);
        return this.captured.slice(start).flatMap((c) => c.payloads);
      }
      if (Date.now() >= deadline) return payloads;
      await this.nextResponse(deadline - Date.now());
    }
  }
}
