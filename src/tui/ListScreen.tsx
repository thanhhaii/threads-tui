import { Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { ListSource, Post } from "../model.ts";
import type { ListState, ThreadsService } from "../service.ts";
import type { TerminalGraphics } from "../terminal.ts";
import type { ImageMode } from "../viewer.ts";
import type { Nav } from "./App.tsx";
import { postLines } from "./postLines.ts";
import { ScrollList, type Item } from "./ScrollList.tsx";
import { useAsync } from "./useAsync.ts";
import { useCursor } from "./useCursor.ts";
import { useFullscreen } from "./useFullscreen.ts";

// Load the next page when the cursor gets this close to the end.
const PREFETCH = 3;
// Pictures are fetched only for threads within this distance of the cursor.
const THUMB_WINDOW = 4;

export function ListScreen(props: {
  service: ThreadsService;
  source: ListSource;
  nav: Nav;
  active: boolean;
  graphics: TerminalGraphics;
  imageMode: ImageMode;
}) {
  const { service, nav, active } = props;
  const [list, setList] = useState<ListState>();
  const { busy, run } = useAsync(nav.setStatus);
  const fullscreen = useFullscreen(service, nav, props.graphics, props.imageMode);

  const threads = list?.threads ?? [];
  // Cursor is needed before building items so only threads near it fetch pictures.
  const [sel, setSel] = useCursor(threads.length, active);
  // A group is a root post plus its continuation/reply context; opening the root shows the whole conversation.
  const items: { item: Item; post: Post }[] = threads.flatMap((t, i) => {
    const [first, ...rest] = service.store.threadPosts(t);
    if (!first) return [];
    const thumb = Math.abs(i - sel) <= THUMB_WINDOW ? nav.thumb : undefined;
    return [
      {
        post: first,
        item: {
          key: t.id,
          lines: [
            ...postLines(first, { maxTextLines: 8, thumb }),
            ...rest.flatMap((c) => postLines(c, { maxTextLines: 4 }).map((l) => ({ ...l, text: `┆ ${l.text}` }))),
          ],
        },
      },
    ];
  });

  const load = () =>
    run("Loading", async () => {
      setList(await service.openList(props.source));
      setSel(0);
    });
  useEffect(() => void load(), []);

  useEffect(() => {
    if (list?.hasMore && !busy && items.length && sel >= items.length - PREFETCH)
      void run("Loading more", async () => setList(await service.loadMore()));
  }, [sel, items.length, list?.hasMore, busy]);

  useInput(
    (input, key) => {
      if (input === "r") void load();
      const cur = items[sel]?.post;
      if (key.return && cur) nav.push({ kind: "post", code: cur.code });
      if (input === "v" && cur) nav.push({ kind: "reader", post: cur });
      if (input === "z" && cur) {
        if (!cur.images.length) nav.setStatus("This post has no image");
        else if (!fullscreen.ok) nav.setStatus("Full screen images are not available in this terminal");
        else fullscreen.open(cur, 0);
      }
    },
    { isActive: active },
  );

  if (!list) return <Text dimColor>{busy ? "Loading…" : "Nothing loaded."}</Text>;
  if (!items.length) return <Text dimColor>No posts. Press r to retry.</Text>;
  return (
    <ScrollList
      items={items.map((i) => i.item)}
      selected={sel}
      height={nav.height}
      width={nav.width}
      footer={busy ? "Loading more…" : list.hasMore ? "" : "— end —"}
    />
  );
}
