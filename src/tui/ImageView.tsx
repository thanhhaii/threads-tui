import { Box, Text } from "ink";
import type { ImageRow } from "../image.ts";

/** One picture row as `▀` cells; runs of equal colors are merged to keep the frame small. */
export function ImageCells(props: { row: ImageRow }) {
  const runs: { fg: string; bg: string; n: number }[] = [];
  for (const c of props.row) {
    const last = runs[runs.length - 1];
    if (last && last.fg === c.fg && last.bg === c.bg) last.n++;
    else runs.push({ ...c, n: 1 });
  }
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} color={r.fg} backgroundColor={r.bg}>
          {"▀".repeat(r.n)}
        </Text>
      ))}
    </>
  );
}

/** Draws pre-rendered half-block rows. */
export function ImageView(props: { rows: ImageRow[] }) {
  return (
    <Box flexDirection="column">
      {props.rows.map((row, y) => (
        <Text key={y} wrap="truncate-end">
          {"  "}
          <ImageCells row={row} />
        </Text>
      ))}
    </Box>
  );
}
