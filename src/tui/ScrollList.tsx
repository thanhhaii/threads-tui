import { Box, Text } from "ink";
import wrapAnsi from "wrap-ansi";
import type { ImageRow } from "../image.ts";
import { ImageCells } from "./ImageView.tsx";

export interface Line {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  /** one row of picture cells, drawn after `text` (used as indent); never wrapped */
  cells?: ImageRow;
}

export interface Item {
  key: string;
  /** indent prefix drawn on every line, e.g. tree guides */
  prefix?: string;
  lines: Line[];
}

/** Wrap logical lines to the width left after the prefix and selection marker. */
export function layout(item: Item, width: number): Line[] {
  const prefix = item.prefix ?? "";
  const avail = Math.max(10, width - prefix.length - 2);
  return item.lines.flatMap((l) =>
    l.cells
      ? [{ ...l, text: prefix + l.text }]
      : wrapAnsi(l.text || " ", avail, { hard: true, trim: false })
          .split("\n")
          .map((t) => ({ ...l, text: prefix + t })),
  );
}

/**
 * Renders items so the selected one is fully visible. `height` is in terminal rows.
 * Each item is followed by a blank separator row.
 */
export function ScrollList(props: { items: Item[]; selected: number; height: number; width: number; footer?: string }) {
  const laid = props.items.map((it) => layout(it, props.width));
  const sizes = laid.map((l) => l.length + 1);
  const sel = Math.min(Math.max(0, props.selected), props.items.length - 1);

  // Start from the selected item and grow upward while it fits, keeping context above.
  let first = sel;
  let used = sizes[sel] ?? 0;
  while (first > 0 && used + sizes[first - 1]! <= props.height * 0.4 + (sizes[sel] ?? 0)) {
    first--;
    used += sizes[first]!;
  }
  const rows: { line: Line; selected: boolean; key: string }[] = [];
  for (let i = first; i < laid.length && rows.length < props.height; i++) {
    for (const [j, line] of laid[i]!.entries()) rows.push({ line, selected: i === sel, key: `${props.items[i]!.key}:${j}` });
    rows.push({ line: { text: "" }, selected: false, key: `${props.items[i]!.key}:sep` });
  }
  if (props.footer && rows.length < props.height) rows.push({ line: { text: props.footer, dim: true }, selected: false, key: "footer" });

  return (
    <Box flexDirection="column">
      {rows.slice(0, props.height).map((r) => (
        <Text key={r.key} wrap="truncate-end">
          <Text color="cyan">{r.selected ? "▌ " : "  "}</Text>
          <Text color={r.line.color} dimColor={r.line.dim} bold={r.line.bold}>
            {r.line.text}
          </Text>
          {r.line.cells && <ImageCells row={r.line.cells} />}
        </Text>
      ))}
    </Box>
  );
}
