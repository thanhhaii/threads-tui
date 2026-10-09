import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { encodeSixel, imageToSixel } from "../src/sixel.ts";

/** Minimal sixel decoder for the subset the encoder emits: palette, #color, !repeat, $ and -. Returns 0xRRGGBB per pixel. */
function decode(seq: string): { width: number; height: number; px: number[] } {
  const body = seq.slice(seq.indexOf("q") + 1, seq.lastIndexOf("\x1b\\"));
  const raster = /^"1;1;(\d+);(\d+)/.exec(body)!;
  const width = Number(raster[1]);
  const height = Number(raster[2]);
  const px = new Array<number>(width * height).fill(-1);
  const palette = new Map<number, number>();
  let color = 0;
  let x = 0;
  let band = 0;
  let i = raster[0].length;
  const num = () => {
    const m = /^\d+/.exec(body.slice(i))!;
    i += m[0].length;
    return Number(m[0]);
  };
  const paint = (ch: string, n: number) => {
    const bits = ch.charCodeAt(0) - 63;
    for (let k = 0; k < n; k++, x++)
      for (let b = 0; b < 6; b++) if (bits & (1 << b) && band * 6 + b < height) px[(band * 6 + b) * width + x] = palette.get(color)!;
  };
  while (i < body.length) {
    const c = body[i]!;
    if (c === "#") {
      i++;
      const reg = num();
      if (body[i] === ";") {
        const [, r, g, bl] = /^;2;(\d+);(\d+);(\d+)/.exec(body.slice(i))!;
        i += /^;2;\d+;\d+;\d+/.exec(body.slice(i))![0].length;
        const to255 = (p: string) => Math.round((Number(p) * 255) / 100);
        palette.set(reg, (to255(r!) << 16) | (to255(g!) << 8) | to255(bl!));
      } else color = reg;
    } else if (c === "!") {
      i++;
      const n = num();
      paint(body[i++]!, n);
    } else if (c === "$") {
      x = 0;
      i++;
    } else if (c === "-") {
      x = 0;
      band++;
      i++;
    } else {
      paint(c, 1);
      i++;
    }
  }
  return { width, height, px };
}

describe("encodeSixel", () => {
  test("round-trips every pixel, including a partial last band and long runs", () => {
    // 9 wide x 8 high: band 2 has only 2 rows; columns form runs longer than the repeat threshold.
    const width = 9;
    const height = 8;
    const palette = [0xff0000, 0x0000ff, 0x00ff00];
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) indices[y * width + x] = x < 5 ? 0 : y % 3 === 0 ? 1 : 2;
    const d = decode(encodeSixel({ width, height, indices, palette }));
    expect([d.width, d.height]).toEqual([width, height]);
    expect(d.px).toEqual(Array.from(indices, (i) => palette[i]));
  });

  test("uses the repeat form for runs over 3", () => {
    const s = encodeSixel({ width: 10, height: 6, indices: new Uint8Array(60), palette: [0x000000] });
    expect(s).toContain("!10~");
  });
});

describe("imageToSixel", () => {
  test("fits the requested box, keeps aspect ratio, and preserves flat colors", async () => {
    // 200x100 picture: left half red, right half blue.
    const svg = `<svg width="200" height="100"><rect width="100" height="100" fill="#ff0000"/><rect x="100" width="100" height="100" fill="#0000ff"/></svg>`;
    const s = await imageToSixel(await sharp(Buffer.from(svg)).png().toBuffer(), 100, 100);
    expect([s.width, s.height]).toEqual([100, 50]);
    const d = decode(s.data);
    const at = (x: number, y: number) => d.px[y * d.width + x];
    expect(at(10, 25)).toBe(0xff0000);
    expect(at(90, 25)).toBe(0x0000ff);
  });
});
