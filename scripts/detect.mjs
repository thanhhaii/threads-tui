// Prints what this terminal reports about sixel and cell size. Run directly in Windows Terminal.
process.stdin.setRawMode(true);
process.stdin.resume();
let buf = "";
process.stdin.on("data", (d) => (buf += d.toString("latin1")));
process.stdout.write("\x1b[16t\x1b[14t\x1b[c");
setTimeout(() => {
  process.stdin.setRawMode(false);
  process.stdin.pause();
  const da1 = /\x1b\[\?([\d;]*)c/.exec(buf)?.[1] ?? "";
  console.log("\nraw reply:", JSON.stringify(buf));
  console.log("DA1 attributes:", da1, "-> sixel:", da1.split(";").includes("4"));
  console.log("cell px:", /\x1b\[6;(\d+);(\d+)t/.exec(buf)?.slice(1).join("x") ?? "not reported");
  console.log("WT_SESSION:", process.env.WT_SESSION ? "yes" : "no", "TERM_PROGRAM:", process.env.TERM_PROGRAM ?? "-");
  process.exit(0);
}, 1500);
