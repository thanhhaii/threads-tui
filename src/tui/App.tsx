import { Box, Text, useApp, useInput, useStdout, useWindowSize } from "ink";
import { useEffect, useState } from "react";
import { canShowImages } from "../image.ts";
import type { ListSource, Post } from "../model.ts";
import type { ThreadsService } from "../service.ts";
import type { TerminalGraphics } from "../terminal.ts";
import { thumbnails, useThumbnails } from "./thumbnails.ts";
import type { ThumbSize } from "./postLines.ts";
import type { ImageMode } from "../viewer.ts";
import { ListScreen } from "./ListScreen.tsx";
import { PostScreen } from "./PostScreen.tsx";
import { Prompt } from "./Prompt.tsx";
import { ReaderScreen } from "./ReaderScreen.tsx";

export type Screen =
  | { kind: "list"; source: ListSource; key: number }
  | { kind: "post"; code: string }
  | { kind: "reader"; post: Post };

export interface Nav {
  push(s: Screen): void;
  pop(): void;
  setStatus(s: string): void;
  height: number;
  width: number;
  /** size of pictures drawn under posts in lists; undefined when inline images are off */
  thumb?: ThumbSize;
}

const HELP_BY_KIND: Record<Screen["kind"], string> = {
  list: "j/k move · enter open · z full-screen image · i images · r refresh · f feed · p profile · / search · g open post · q quit",
  post: "j/k move · space expand · enter read · i images · m more replies · o open as root · r refresh · esc back",
  reader: "j/k scroll · space page · h/l prev/next image · z full screen · i toggle images · esc back",
};

// Inline pictures: at most this many rows, and never more than about half the screen.
const THUMB_MAX_ROWS = 14;

export function App(props: { service: ThreadsService; initial: ListSource; graphics: TerminalGraphics; imageMode: ImageMode }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [stack, setStack] = useState<Screen[]>([{ kind: "list", source: props.initial, key: 0 }]);
  const [status, setStatus] = useState(
    props.service.loggedIn ? "" : "Not logged in: showing public content. Quit and run `threads login`.",
  );
  const [prompt, setPrompt] = useState<{ label: string; onSubmit: (v: string) => void }>();
  // Async status messages (e.g. "Loading…" cleared to "") would erase a warning; keep it separately.
  const [warning, setWarning] = useState("");
  useEffect(() => {
    props.service.warn = setWarning;
    thumbnails.attach(props.service);
  }, [props.service]);
  const colorOk = canShowImages(useStdout().stdout);
  const [inlineImages, setInlineImages] = useState(colorOk && props.imageMode !== "off");
  useThumbnails(inlineImages);
  const top = stack[stack.length - 1]!;

  const nav: Nav = {
    push: (s) => setStack((st) => [...st, s]),
    pop: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
    setStatus,
    // header 1 + status 1 + help 1
    height: Math.max(5, rows - 3),
    width: columns,
    thumb: inlineImages
      ? { cols: Math.min(columns - 8, THUMB_MAX_ROWS * 4), rows: Math.max(4, Math.min(THUMB_MAX_ROWS, Math.floor((rows - 3) / 2))) }
      : undefined,
  };

  const replaceList = (source: ListSource) => setStack([{ kind: "list", source, key: Date.now() }]);

  useInput(
    (input, key) => {
      if (input === "q" && top.kind === "list") exit();
      if ((key.escape || input === "q" || key.backspace) && top.kind !== "list") nav.pop();
      if (key.ctrl && input === "c") exit();
      if (input === "f") replaceList({ kind: "feed" });
      if (input === "i" && top.kind !== "reader" && colorOk) setInlineImages((v) => !v);
      if (input === "p")
        setPrompt({ label: "Profile @", onSubmit: (v) => v && replaceList({ kind: "profile", username: v }) });
      if (input === "/") setPrompt({ label: "Search", onSubmit: (v) => v && replaceList({ kind: "search", query: v }) });
      if (input === "g") setPrompt({ label: "Post code or URL", onSubmit: (v) => v && nav.push({ kind: "post", code: v }) });
    },
    { isActive: !prompt },
  );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box>
        <Text bold color="magentaBright">
          threads{" "}
        </Text>
        <Text dimColor>{stack.map(describe).join(" › ")}</Text>
      </Box>
      {/* Screens below the top stay mounted (hidden) so going back keeps their state. */}
      {stack.map((s, i) => {
        const active = i === stack.length - 1 && !prompt;
        return (
          <Box key={screenKey(s, i)} display={i === stack.length - 1 ? "flex" : "none"} flexGrow={1} flexDirection="column" overflow="hidden">
            {s.kind === "list" && (
              <ListScreen service={props.service} source={s.source} nav={nav} active={active} graphics={props.graphics} imageMode={props.imageMode} />
            )}
            {s.kind === "post" && <PostScreen service={props.service} code={s.code} nav={nav} active={active} />}
            {s.kind === "reader" && (
              <ReaderScreen service={props.service} post={s.post} nav={nav} active={active} graphics={props.graphics} imageMode={props.imageMode} />
            )}
          </Box>
        );
      })}
      {prompt ? (
        <Prompt
          label={prompt.label}
          onDone={(v) => {
            setPrompt(undefined);
            if (v !== undefined) prompt.onSubmit(v.trim());
          }}
        />
      ) : (
        <Text color={warning || status ? "yellow" : undefined} wrap="truncate-end">
          {status || warning || " "}
        </Text>
      )}
      <Text dimColor wrap="truncate-end">
        {HELP_BY_KIND[top.kind]}
      </Text>
    </Box>
  );
}

function describe(s: Screen): string {
  switch (s.kind) {
    case "list":
      return s.source.kind === "feed" ? "feed" : s.source.kind === "profile" ? `@${s.source.username}` : `search "${s.source.query}"`;
    case "post":
      return `post ${s.code}`;
    case "reader":
      return `@${s.post.author.username}`;
  }
}

function screenKey(s: Screen, depth: number): string {
  switch (s.kind) {
    case "list":
      return `${depth}:list:${s.key}`;
    case "post":
      return `${depth}:post:${s.code}`;
    case "reader":
      return `${depth}:reader:${s.post.id}`;
  }
}
