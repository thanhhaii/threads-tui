import sharp from "sharp";

/** One terminal row of the picture: each cell is `▀` with fg = top pixel, bg = bottom pixel. */
export type ImageRow = { fg: string; bg: string }[];

export interface RenderedImage {
  rows: ImageRow[];
  /** width in terminal cells */
  cols: number;
}

/** Half-block pictures need at least 256 colors; respects NO_COLOR / FORCE_COLOR / TERM. */
export function canShowImages(stdout: NodeJS.WritableStream): boolean {
  return "isTTY" in stdout && stdout.isTTY === true && "hasColors" in stdout && typeof stdout.hasColors === "function" && stdout.hasColors(256) === true;
}

const hex = (r: number, g: number, b: number) => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

/**
 * Downscale to fit `maxCols` x `maxRows` cells. Terminal cells are ~2x taller than wide,
 * and each cell holds two vertical pixels, so one pixel maps to one cell column.
 */
export async function renderImage(bytes: Buffer, maxCols: number, maxRows: number): Promise<RenderedImage> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({ width: Math.max(1, maxCols), height: Math.max(2, maxRows * 2), fit: "inside" })
    .flatten({ background: "#000000" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const px = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return hex(data[i]!, data[i + 1]!, data[i + 2]!);
  };
  const rows: ImageRow[] = [];
  for (let y = 0; y < height; y += 2) {
    const row: ImageRow = [];
    for (let x = 0; x < width; x++) row.push({ fg: px(x, y), bg: y + 1 < height ? px(x, y + 1) : "#000000" });
    rows.push(row);
  }
  return { rows, cols: width };
}
