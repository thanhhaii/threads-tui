import sharp from "sharp";

const ESC = "\x1b";
// Sixel palettes are practically capped at 256 registers.
const MAX_COLORS = 256;

/** Quantised picture: one palette index per pixel. */
interface Indexed {
  width: number;
  height: number;
  indices: Uint8Array;
  /** packed 0xRRGGBB per palette entry */
  palette: number[];
}

/** Resize to fit width x height pixels and reduce to <= 256 colors with libimagequant (dithered). */
async function quantize(bytes: Buffer, maxWidth: number, maxHeight: number): Promise<Indexed> {
  const png = await sharp(bytes)
    .rotate()
    .resize({ width: Math.max(1, maxWidth), height: Math.max(1, maxHeight), fit: "inside" })
    .flatten({ background: "#000000" })
    .png({ palette: true, colours: MAX_COLORS, dither: 1, effort: 4 })
    .toBuffer();
  // Decoding the palette PNG yields RGB pixels drawn from at most 256 distinct colors.
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lookup = new Map<number, number>();
  const palette: number[] = [];
  const indices = new Uint8Array(info.width * info.height);
  for (let p = 0, i = 0; p < indices.length; p++, i += 3) {
    const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    let idx = lookup.get(rgb);
    if (idx === undefined) {
      idx = palette.length;
      lookup.set(rgb, idx);
      palette.push(rgb);
    }
    indices[p] = idx;
  }
  return { width: info.width, height: info.height, indices, palette };
}

/** Appends `count` copies of sixel char `ch`, using the `!n` repeat form when shorter. */
function emitRun(out: string[], ch: number, count: number): void {
  const c = String.fromCharCode(ch);
  out.push(count > 3 ? `!${count}${c}` : c.repeat(count));
}

/** Encodes indexed pixels as a complete DCS sixel sequence. */
export function encodeSixel(img: Indexed): string {
  const { width, height, indices, palette } = img;
  const out: string[] = [`${ESC}P0;1;q"1;1;${width};${height}`];
  palette.forEach((rgb, i) => {
    const pct = (v: number) => Math.round((v * 100) / 255);
    out.push(`#${i};2;${pct(rgb >> 16)};${pct((rgb >> 8) & 255)};${pct(rgb & 255)}`);
  });
  // Per band of 6 rows: one bit-column array per color that appears in the band.
  const bands = new Map<number, Uint8Array>();
  for (let y0 = 0; y0 < height; y0 += 6) {
    bands.clear();
    for (let dy = 0; dy < 6 && y0 + dy < height; dy++) {
      const row = (y0 + dy) * width;
      const bit = 1 << dy;
      for (let x = 0; x < width; x++) {
        const idx = indices[row + x]!;
        let cols = bands.get(idx);
        if (!cols) {
          cols = new Uint8Array(width);
          bands.set(idx, cols);
        }
        cols[x]! |= bit;
      }
    }
    let first = true;
    for (const [idx, cols] of bands) {
      if (!first) out.push("$");
      first = false;
      out.push(`#${idx}`);
      let run = 0;
      let prev = -1;
      for (let x = 0; x < width; x++) {
        const ch = 63 + cols[x]!;
        if (ch === prev) run++;
        else {
          if (run) emitRun(out, prev, run);
          prev = ch;
          run = 1;
        }
      }
      if (run) emitRun(out, prev, run);
    }
    out.push("-");
  }
  out.push(`${ESC}\\`);
  return out.join("");
}

/** Image bytes -> sixel string sized to fit `maxWidth` x `maxHeight` pixels. */
export async function imageToSixel(bytes: Buffer, maxWidth: number, maxHeight: number): Promise<{ data: string; width: number; height: number }> {
  const img = await quantize(bytes, maxWidth, maxHeight);
  return { data: encodeSixel(img), width: img.width, height: img.height };
}
