import { useCallback, useRef, useState } from "react";
import { SessionError } from "../browser.ts";

/** Runs one async action at a time and reports progress/errors to the status bar. */
export function useAsync(setStatus: (s: string) => void) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(
    async (label: string, job: () => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setStatus(`${label}…`);
      try {
        await job();
        setStatus("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(e instanceof SessionError ? `${msg}. Quit and run \`threads login\`.` : `Error: ${msg}`);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [setStatus],
  );
  return { busy, run };
}
