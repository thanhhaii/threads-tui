import { useEffect, useState } from "react";
import { renderImage, type RenderedImage } from "../image.ts";
import type { ThreadsService } from "../service.ts";

// Raw bytes per URL; re-rendering at a new size is cheap, downloading is not.
const bytesCache = new Map<string, Promise<Buffer>>();

export type ImageState = { status: "loading" } | { status: "ready"; image: RenderedImage } | { status: "error"; message: string };

export function useImage(service: ThreadsService, url: string | undefined, cols: number, rows: number): ImageState | undefined {
  const [state, setState] = useState<ImageState>();
  useEffect(() => {
    if (!url) return setState(undefined);
    let cancelled = false;
    setState({ status: "loading" });
    let bytes = bytesCache.get(url);
    if (!bytes) {
      bytes = service.fetchImage(url);
      bytesCache.set(url, bytes);
      // A failed download must be retryable later.
      bytes.catch(() => bytesCache.delete(url));
    }
    bytes
      .then((b) => renderImage(b, cols, rows))
      .then(
        (image) => !cancelled && setState({ status: "ready", image }),
        (e: unknown) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      cancelled = true;
    };
  }, [service, url, cols, rows]);
  return state;
}
