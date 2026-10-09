// Full-screen image viewer that draws straight to the terminal while Ink is suspended.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderImage } from "./image.ts";
import type { MediaImage } from "./model.ts";
import { imageToSixel } from "./sixel.ts";
import type { TerminalGraphics } from "./terminal.ts";

export type ImageMode = "sixel" | "blocks" | "off";

const ESC = "\x1b";
const ALT_ON = `${ESC}[?1049h${ESC}[?25l`;
const ALT_OFF = `${ESC}[?25h${ESC}[?1049l`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const moveTo = (row: number, col: number) => `${ESC}[${row};${col}H`;

/** Half-block fallback as raw ANSI: fg = top pixel, bg = bottom pixel. */
async function blockLines(bytes: Buffer, cols: number, rows: number): Promise<{ lines: string[]; cols: number }> {
  const img = await renderImage(bytes, cols, rows);
  const rgb = (h: string) => `${parseInt(h.slice(1, 3), 16)};${parseInt(h.slice(3, 5), 16)};${parseInt(h.slice(5, 7), 16)}`;
  const lines = img.rows.map((row) => row.map((c) => `${ESC}[38;2;${rgb(c.fg)}m${ESC}[48;2;${rgb(c.bg)}m▀`).join("") + `${ESC}[0m`);
  return { lines, cols: img.cols };
}

/** Saves the image to a temp file and opens it with the OS default viewer. */
export function openExternally(bytes: Buffer, name: string): string {
  const file = join(tmpdir(), `threads-tui-${name.replace(/[^\w.-]+/g, "_")}.jpg`);
  writeFileSync(file, bytes);
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", file]]
      : process.platform === "darwin"
        ? ["open", [file]]
        : ["xdg-open", [file]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return file;
}

type Key = "next" | "prev" | "open" | "close" | "other";

/** Terminal streams the viewer takes over; Ink's own streams while it is suspended. */
export interface ViewerIo {
  input: NodeJS.ReadStream;
  output: NodeJS.WritableStream;
  size: () => { cols: number; rows: number };
}

/** A readable stream that can switch to raw mode, i.e. a TTY. */
export function isRawInput(s: NodeJS.ReadableStream): s is NodeJS.ReadStream {
  return "setRawMode" in s && typeof s.setRawMode === "function";
}

/**
 * Waits for the next key. Reads the same way Ink does ('readable' + read()) so the stream never switches
 * to flowing mode, which on Windows TTYs leaves Ink unable to read after it resumes.
 * A chunk can hold several keys (fast typing, or Enter after the key); only the first counts.
 */
function readKey(input: NodeJS.ReadStream): Promise<Key> {
  const { promise, resolve } = Promise.withResolvers<Key>();
  const onReadable = () => {
    let s = "";
    for (let chunk = input.read(); chunk !== null; chunk = input.read()) s += chunk.toString();
    if (!s) return;
    input.off("readable", onReadable);
    if (s.startsWith(`${ESC}[C`)) resolve("next");
    else if (s.startsWith(`${ESC}[D`)) resolve("prev");
    else if (s.startsWith(ESC)) resolve("close");
    else if (s[0] === "l") resolve("next");
    else if (s[0] === "h") resolve("prev");
    else if (s[0] === "o") resolve("open");
    else if (s[0] === "q" || s[0] === "z" || s[0] === "\r" || s[0] === "\x03") resolve("close");
    else resolve("other");
  };
  input.on("readable", onReadable);
  return promise;
}

export interface ViewerOptions {
  images: MediaImage[];
  start: number;
  mode: Exclude<ImageMode, "off">;
  graphics: TerminalGraphics;
  fetch: (url: string) => Promise<Buffer>;
  title: string;
}

/**
 * Owns the terminal until the user closes it; returns the index last shown.
 * Must run while Ink is suspended (`useApp().suspendTerminal`).
 */
export async function showFullscreen(io: ViewerIo, o: ViewerOptions): Promise<number> {
  const out = io.output;
  let index = o.start;
  out.write(ALT_ON);
  // Ink turned raw mode off when it suspended; keys must arrive one by one, unechoed.
  io.input.setRawMode(true);
  try {
    for (;;) {
      const img = o.images[index]!;
      const { cols, rows } = io.size();
      const header = ` ${o.title} · ${img.video ? "▶ video poster " : ""}${index + 1}/${o.images.length} · h/l switch · o open in photo viewer · esc close`;
      out.write(CLEAR + `${ESC}[7m${header.slice(0, cols).padEnd(cols)}${ESC}[0m` + moveTo(2, 1) + " Loading…");
      let bytes: Buffer;
      try {
        bytes = await o.fetch(img.fullUrl);
        // Picture area: below the header, one row kept free for messages.
        const areaRows = Math.max(2, rows - 2);
        out.write(moveTo(2, 1) + `${ESC}[2K`);
        if (o.mode === "sixel") {
          const g = o.graphics;
          const s = await imageToSixel(bytes, cols * g.cellWidth, areaRows * g.cellHeight);
          const used = Math.ceil(s.width / g.cellWidth);
          out.write(moveTo(2, Math.max(1, Math.floor((cols - used) / 2) + 1)) + s.data);
        } else {
          const b = await blockLines(bytes, cols, areaRows);
          const left = Math.max(1, Math.floor((cols - b.cols) / 2) + 1);
          b.lines.forEach((l, i) => out.write(moveTo(2 + i, left) + l));
        }
      } catch (e) {
        out.write(moveTo(3, 1) + ` ${ESC}[31mImage failed: ${e instanceof Error ? e.message : String(e)}${ESC}[0m`);
        bytes = Buffer.alloc(0);
      }
      for (;;) {
        const key = await readKey(io.input);
        if (key === "close") return index;
        if (key === "open" && bytes.length) {
          const file = openExternally(bytes, `${o.title}-${index + 1}`);
          out.write(moveTo(rows, 1) + `${ESC}[2K Opened ${file}`);
          continue;
        }
        if (key === "next" || key === "prev") {
          if (o.images.length === 1) continue;
          index = key === "next" ? (index + 1) % o.images.length : (index - 1 + o.images.length) % o.images.length;
          break;
        }
      }
    }
  } finally {
    // Raw mode stays on: Ink sets it again on resume, and on Windows toggling it off here left Ink's
    // own setRawMode(true) failing with EPIPE.
    out.write(CLEAR + ALT_OFF);
  }
}
