import { useApp, useStdin, useStdout } from "ink";
import { canShowImages } from "../image.ts";
import type { Post } from "../model.ts";
import type { ThreadsService } from "../service.ts";
import type { TerminalGraphics } from "../terminal.ts";
import { isRawInput, showFullscreen, type ImageMode } from "../viewer.ts";
import type { Nav } from "./App.tsx";

/** Opens a post's pictures in the full-screen viewer; `ok` is false when the terminal cannot show it. */
export function useFullscreen(service: ThreadsService, nav: Nav, graphics: TerminalGraphics, imageMode: ImageMode) {
  const { suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const ok = imageMode !== "off" && (imageMode === "sixel" || canShowImages(stdout)) && isRawInput(stdin);

  const open = (post: Post, start: number, onClose?: (last: number) => void) => {
    if (imageMode === "off" || !isRawInput(stdin) || !ok || !post.images.length) return;
    void suspendTerminal(async () => {
      const last = await showFullscreen(
        { input: stdin, output: stdout, size: () => ({ cols: nav.width, rows: nav.height + 3 }) },
        {
          images: post.images,
          start,
          mode: imageMode,
          graphics,
          fetch: (url) => service.fetchImage(url),
          title: `@${post.author.username}`,
        },
      );
      onClose?.(last);
    });
  };

  return { ok, open };
}
