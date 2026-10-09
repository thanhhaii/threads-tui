// Probe: list data roots embedded in a page and GraphQL queries it fires; dumps bodies to fixtures/probe.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] ?? "https://www.threads.com/";
const tag = process.argv[3] ?? "page";
const outDir = join(process.cwd(), "fixtures", "probe");
mkdirSync(outDir, { recursive: true });
const profileDir = join(process.env.LOCALAPPDATA ?? ".", "threads-tui", "profile");
const ctx = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: true });
const page = ctx.pages()[0] ?? (await ctx.newPage());
let n = 0;
page.on("response", async (res) => {
  if (!res.url().includes("/graphql")) return;
  const name = res.request().headers()["x-fb-friendly-name"] ?? "unknown";
  const body = await res.text().catch(() => "");
  console.log("XHR", name, body.length, "vars:", res.request().postDataJSON?.()?.variables ?? "");
  writeFileSync(join(outDir, `${tag}-xhr-${++n}-${name}.json`), body);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
await page.mouse.wheel(0, 8000);
await page.waitForTimeout(4000);

const scripts = await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent ?? ""));
const roots: Record<string, unknown>[] = [];
const walk = (v: unknown): void => {
  if (Array.isArray(v)) return v.forEach(walk);
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  const r = (o.__bbox as { result?: { data?: Record<string, unknown> } } | undefined)?.result;
  if (r?.data) roots.push(r.data);
  Object.values(o).forEach(walk);
};
for (const s of scripts) {
  try {
    walk(JSON.parse(s));
  } catch {}
}
console.log("EMBEDDED", roots.map((r) => Object.keys(r).join(",")));
writeFileSync(join(outDir, `${tag}-embedded.json`), JSON.stringify(roots));
await ctx.close();
