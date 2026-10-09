import { Box, Text, useInput, useStdout } from "ink";
import { useState, type ReactNode } from "react";
import { canShowImages } from "../image.ts";
import type { Post } from "../model.ts";
import type { ThreadsService } from "../service.ts";
import type { TerminalGraphics } from "../terminal.ts";
import type { ImageMode } from "../viewer.ts";
import type { Nav } from "./App.tsx";
import { ImageView } from "./ImageView.tsx";
import { postLines } from "./postLines.ts";
import { layout, type Line } from "./ScrollList.tsx";
import { useFullscreen } from "./useFullscreen.ts";
import { useImage } from "./useImage.ts";

// Leave room for the caption line and a little text above the picture.
const IMAGE_ROWS_RESERVED = 2;

export function ReaderScreen(props: {
  service: ThreadsService;
  post: Post;
  nav: Nav;
  active: boolean;
  graphics: TerminalGraphics;
  imageMode: ImageMode;
}) {
  const { post, nav, active } = props;
  const images = post.images;
  const { stdout } = useStdout();
  const colorOk = canShowImages(stdout);
  const fullscreen = useFullscreen(props.service, nav, props.graphics, props.imageMode);
  const fullscreenOk = fullscreen.ok;
  const [showImages, setShowImages] = useState(colorOk);
  const [index, setIndex] = useState(0);
  const [top, setTop] = useState(0);

  const current = showImages ? images[index] : undefined;
  const imgCols = Math.max(10, Math.min(nav.width - 4, 120));
  const imgRows = Math.max(4, nav.height - IMAGE_ROWS_RESERVED);
  const image = useImage(props.service, current?.url, imgCols, imgRows);

  const textLines: Line[] = [
    ...layout({ key: "p", lines: postLines(post) }, nav.width),
    ...(post.quoted ? layout({ key: "q", prefix: "┃ ", lines: postLines(post.quoted) }, nav.width) : []),
    { text: post.url, dim: true },
  ];
  const caption = images.length
    ? `${current?.video ? "▶ video poster" : "image"} ${index + 1}/${images.length}` +
      (images.length > 1 ? " · h/l switch" : "") +
      (fullscreenOk ? ` · z full screen${props.imageMode === "sixel" ? " (sixel)" : ""}` : "") +
      (colorOk ? ` · i ${showImages ? "hide" : "show"} images` : " · terminal has no color support, images off")
    : "";
  // Text and picture scroll together as one column of rows.
  const imageRows = image?.status === "ready" ? image.image.rows.length : current ? 1 : 0;
  const total = textLines.length + (caption ? 1 : 0) + imageRows;
  const maxTop = Math.max(0, total - nav.height);
  const clampedTop = Math.min(top, maxTop);

  useInput(
    (input, key) => {
      if (input === "j" || key.downArrow) setTop((t) => Math.min(maxTop, t + 1));
      if (input === "k" || key.upArrow) setTop((t) => Math.max(0, t - 1));
      if (input === " " || key.pageDown) setTop((t) => Math.min(maxTop, t + nav.height - 1));
      if (input === "i" && colorOk) setShowImages((s) => !s);
      if (images.length > 1 && (input === "l" || key.rightArrow)) setIndex((i) => (i + 1) % images.length);
      if (images.length > 1 && (input === "h" || key.leftArrow)) setIndex((i) => (i - 1 + images.length) % images.length);
      if (input === "z") fullscreen.open(post, index, setIndex);
    },
    { isActive: active },
  );

  // Build the visible window: text lines first, then caption, then picture rows.
  const visible: ReactNode[] = [];
  let row = 0;
  const end = clampedTop + nav.height;
  for (const [i, l] of textLines.entries()) {
    if (row >= clampedTop && row < end)
      visible.push(
        <Text key={`t${i}`} color={l.color} dimColor={l.dim} bold={l.bold} wrap="truncate-end">
          {"  " + l.text}
        </Text>,
      );
    row++;
  }
  if (caption) {
    if (row >= clampedTop && row < end)
      visible.push(
        <Text key="cap" color="blue" wrap="truncate-end">
          {"  " + caption}
        </Text>,
      );
    row++;
  }
  if (current) {
    if (image?.status === "ready") {
      const from = Math.max(0, clampedTop - row);
      const to = Math.max(0, end - row);
      if (to > from) visible.push(<ImageView key={`img${index}`} rows={image.image.rows.slice(from, to)} />);
    } else if (row >= clampedTop && row < end) {
      visible.push(
        <Text key="imgstate" dimColor={image?.status !== "error"} color={image?.status === "error" ? "red" : undefined}>
          {"  " + (image?.status === "error" ? `Image failed: ${image.message}` : "Loading image…")}
        </Text>,
      );
    }
  }

  return <Box flexDirection="column">{visible}</Box>;
}
