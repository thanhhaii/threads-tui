import { useEffect, useState } from "react";
import { renderImage, type ImageRow } from "../image.ts";
import type { MediaImage } from "../model.ts";
import type { ThreadsService } from "../service.ts";

export type Thumb = { status: "loading" } | { status: "ready"; rows: ImageRow[] } | { status: "error" };

// Downloads run in parallel but bounded, so a long feed does not hammer the CDN.
const MAX_PARALLEL = 4;

/** Downloads and renders inline images once per (url, size); notifies subscribers as each one finishes. */
class ThumbnailCache {
  private readonly thumbs = new Map<string, Thumb>();
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;
  private readonly listeners = new Set<() => void>();
  private service?: ThreadsService;

  attach(service: ThreadsService): void {
    this.service = service;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Current state; schedules the download on first request. */
  get(img: MediaImage, cols: number, rows: number): Thumb {
    const key = `${img.url}|${cols}x${rows}`;
    const known = this.thumbs.get(key);
    if (known) return known;
    this.thumbs.set(key, { status: "loading" });
    this.queue.push(async () => {
      try {
        const bytes = await this.service!.fetchImage(img.url);
        const r = await renderImage(bytes, cols, rows);
        this.thumbs.set(key, { status: "ready", rows: r.rows });
      } catch {
        this.thumbs.set(key, { status: "error" });
      }
      this.listeners.forEach((l) => l());
    });
    this.pump();
    return { status: "loading" };
  }

  private pump(): void {
    while (this.running < MAX_PARALLEL && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }
}

export const thumbnails = new ThumbnailCache();

/** Re-renders the caller whenever any thumbnail finishes loading. */
export function useThumbnails(enabled: boolean): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    // Coalesce bursts of finished downloads into one re-render.
    return thumbnails.subscribe(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        bump((v) => v + 1);
      }, 50);
    });
  }, [enabled]);
}
