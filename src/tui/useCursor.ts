import { useInput, type Key } from "ink";
import { useState } from "react";

/** Selection index over `count` rows, driven by j/k, arrows, PgUp/PgDn, Home/End. Always within range. */
export function useCursor(count: number, active: boolean): [number, (i: number) => void] {
  const [raw, setRaw] = useState(0);
  const sel = Math.max(0, Math.min(raw, count - 1));
  const move = (to: number) => setRaw(Math.max(0, Math.min(to, count - 1)));
  useInput(
    (input: string, key: Key) => {
      if (input === "j" || key.downArrow) move(sel + 1);
      if (input === "k" || key.upArrow) move(sel - 1);
      if (key.pageDown) move(sel + 5);
      if (key.pageUp) move(sel - 5);
      if (key.home) move(0);
      if (key.end) move(count - 1);
    },
    { isActive: active },
  );
  return [sel, move];
}
