// Detects what the attached terminal can draw. Queries need raw stdin, so call this before Ink starts.

export interface TerminalGraphics {
  /** DA1 reports attribute 4 */
  sixel: boolean;
  /** pixel size of one character cell; estimated when the terminal does not report it */
  cellWidth: number;
  cellHeight: number;
  cellSizeReported: boolean;
}

const NONE: TerminalGraphics = { sixel: false, cellWidth: 10, cellHeight: 20, cellSizeReported: false };

/** Writes `seq` and collects the reply until `end` matches or `ms` passes. */
function query(seq: string, end: RegExp, ms: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let buf = "";
  const finish = () => {
    clearTimeout(timer);
    process.stdin.off("data", onData);
    resolve(buf);
  };
  const onData = (d: Buffer) => {
    buf += d.toString("latin1");
    if (end.test(buf)) finish();
  };
  const timer = setTimeout(finish, ms);
  process.stdin.on("data", onData);
  process.stdout.write(seq);
  return promise;
}

export async function detectGraphics(): Promise<TerminalGraphics> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return NONE;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    // DA1 goes last in the batch: every VT terminal answers it, so it also bounds the wait for the others.
    const reply = await query("\x1b[16t\x1b[c", /\x1b\[\?[\d;]*c/, 1000);
    const da1 = /\x1b\[\?([\d;]*)c/.exec(reply)?.[1]?.split(";") ?? [];
    const cell = /\x1b\[6;(\d+);(\d+)t/.exec(reply);
    const cellHeight = Number(cell?.[1]);
    const cellWidth = Number(cell?.[2]);
    const reported = cellWidth > 0 && cellHeight > 0;
    return {
      sixel: da1.includes("4"),
      cellWidth: reported ? cellWidth : NONE.cellWidth,
      cellHeight: reported ? cellHeight : NONE.cellHeight,
      cellSizeReported: reported,
    };
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}
