// Turns `npm run probe` output into trimmed test fixtures: npm run fixtures -- <probe-file> <fixture-name>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Bulky fields the parser never reads.
const DROP: Record<string, true> = {
  image_versions2: true,
  video_versions: true,
  profile_pic_url: true,
  hd_profile_pic_versions: true,
  organic_tracking_token: true,
  logging_info_token: true,
  replies_facepile: true,
  relatedPosts: true,
  video_dash_manifest: true,
};

const [src, dest] = process.argv.slice(2);
if (!src || !dest) throw new Error("usage: make-fixtures <fixtures/probe/file.json> <name.json>");
const raw: unknown = JSON.parse(readFileSync(src, "utf8"));
// Probe "-embedded" files hold bare data roots; wrap them the way SSR delivers them.
const payload = src.includes("-embedded") ? { require: (raw as unknown[]).map((data) => ({ __bbox: { result: { data } } })) } : raw;
const text = JSON.stringify(payload, (k, v) => (DROP[k] ? undefined : v));
mkdirSync(join("test", "fixtures"), { recursive: true });
writeFileSync(join("test", "fixtures", dest), text);
console.log(dest, text.length);
