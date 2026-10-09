import { Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { Post } from "../model.ts";
import type { ThreadsService } from "../service.ts";
import type { TreeRow } from "../store.ts";
import type { Nav } from "./App.tsx";
import { postLines } from "./postLines.ts";
import { ScrollList, type Item } from "./ScrollList.tsx";
import { useAsync } from "./useAsync.ts";
import { useCursor } from "./useCursor.ts";

type Row = { kind: "root"; post: Post } | { kind: "reply"; row: TreeRow } | { kind: "more"; parent: Post };

// Pictures are fetched only for rows within this distance of the cursor.
const THUMB_WINDOW = 4;

export function PostScreen(props: { service: ThreadsService; code: string; nav: Nav; active: boolean }) {
  const { service, nav, active } = props;
  const store = service.store;
  const [root, setRoot] = useState<Post>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Bumped after store mutations so the tree re-renders.
  const [, setVersion] = useState(0);
  const { busy, run } = useAsync(nav.setStatus);

  const load = (force: boolean) =>
    run("Loading post", async () => {
      setRoot(await service.openPost(props.code, force));
    });
  useEffect(() => void load(false), []);

  const rows: Row[] = [];
  if (root) {
    rows.push({ kind: "root", post: root });
    for (const r of store.tree(root.id, expanded)) rows.push({ kind: "reply", row: r });
    if (store.hasMoreReplies(root.id)) rows.push({ kind: "more", parent: root });
  }

  // Cursor first, so only rows near it fetch pictures.
  const [sel] = useCursor(rows.length, active);
  const thumbFor = (i: number) => (Math.abs(i - sel) <= THUMB_WINDOW ? nav.thumb : undefined);
  const items: Item[] = rows.map((r, i) => {
    if (r.kind === "root") return { key: "root", lines: postLines(r.post, { thumb: thumbFor(i) }) };
    if (r.kind === "more") return { key: `more:${r.parent.id}`, lines: [{ text: "… more replies (m)", color: "cyan" }] };
    const { post, depth, expanded: open, canLoad } = r.row;
    const known = store.childIds(post.id).length;
    const marker = open ? "▾" : known || canLoad ? "▸" : "·";
    const note = post.replyCount ? `${marker} ${post.replyCount} repl${post.replyCount === 1 ? "y" : "ies"}` : "";
    return { key: post.id, prefix: "│ ".repeat(depth + 1), lines: postLines(post, { maxTextLines: 6, note, thumb: thumbFor(i) }) };
  });

  const toggle = (row: TreeRow) =>
    run("Loading replies", async () => {
      const { post } = row;
      if (row.expanded) {
        setExpanded((e) => new Set([...e].filter((id) => id !== post.id)));
        return;
      }
      if (row.canLoad) await service.openPost(post.code);
      setExpanded((e) => new Set(e).add(post.id));
      setVersion((v) => v + 1);
    });

  useInput(
    (input, key) => {
      if (input === "r") void load(true);
      const cur = rows[sel];
      if (!cur) return;
      if (input === " " || key.rightArrow || key.leftArrow) {
        if (cur.kind === "reply" && (key.leftArrow ? cur.row.expanded : true)) void toggle(cur.row);
      }
      if (key.return) {
        if (cur.kind === "more") void moreReplies(cur.parent);
        else nav.push({ kind: "reader", post: cur.kind === "root" ? cur.post : cur.row.post });
      }
      if (input === "m" && root) void moreReplies(root);
      if (input === "o" && cur.kind === "reply") nav.push({ kind: "post", code: cur.row.post.code });
    },
    { isActive: active },
  );

  const moreReplies = (parent: Post) =>
    run("Loading more replies", async () => {
      await service.moreReplies(parent);
      setVersion((v) => v + 1);
    });

  if (!root) return <Text dimColor>{busy ? "Loading…" : "Post not loaded. Press r to retry."}</Text>;
  return <ScrollList items={items} selected={sel} height={nav.height} width={nav.width} footer={rows.length === 1 ? "No replies." : ""} />;
}
