# threads-tui

Read Threads (threads.com) in the terminal. A headless Chrome with your own logged-in profile loads the real
web pages; the app reads the JSON those pages receive and shows it as a keyboard-driven TUI. Read-only: it never
likes, posts or replies.

> Uses Threads' private web data, not the official API. This is against Meta's Terms of Service and may break
> when Threads changes. Use a secondary account.

## Requirements
- Node 22+
- Google Chrome installed (Playwright drives it with `channel: "chrome"`)

## Setup
```sh
npm install
npm link            # optional: puts `threads` on PATH
threads login       # opens Chrome; log in, the window closes by itself
```
The session lives in `%LOCALAPPDATA%\threads-tui\profile` (`threads logout` deletes it).
Without login you get public content only, and Threads stops showing replies after the first pages.

## TUI
```sh
threads                     # home feed
threads --profile zuck      # someone's posts
threads --search typescript
```

| Screen | Keys |
|---|---|
| everywhere | `j`/`k` or arrows move, PgUp/PgDn, Home/End, `f` feed, `p` profile, `/` search, `g` open a post code/URL, `q` back/quit |
| list | `Enter` open thread, `v` read post, `z` full-screen image of the selected post, `i` show/hide pictures, `r` refresh; scrolling to the end loads more |
| post | `Space`/`→` expand or collapse replies (loads deeper levels on demand), `Enter` read, `i` show/hide pictures, `m` more top-level replies, `o` open reply as root, `r` refresh, `Esc` back |
| reader | `j`/`k` scroll, `Space` page down, `h`/`l` previous/next image, `z` full-screen image, `i` hide/show images, `Esc` back |
| full-screen image | `h`/`l` previous/next, `o` open in the OS photo viewer, `Esc`/`z`/`q` back |

Pictures are drawn right under each post in lists and in the post screen, as colored half-block characters
(up to 3 carousel images side by side; videos show their poster frame). Only posts near the cursor are downloaded,
4 at a time. `i` hides them for a compact text view. `--images off` starts with them hidden.

`z` opens the largest available version full screen:
- **Sixel** (real pixels) when the terminal reports sixel support at startup, or with `--images sixel`.
  Windows Terminal 1.22+ draws sixel but may not announce it; if `z` shows colored blocks, try
  `threads --images sixel`. If that prints garbage, your terminal has no sixel support: use the default.
- **Colored blocks** otherwise (`--images blocks`), the same technique as the preview but using the whole screen.
- `o` always works: it saves the picture to a temp file and opens your normal photo viewer.

`node scripts/detect.mjs` (run directly in your terminal) prints what the terminal reports.
Pictures are downloaded through the logged-in browser session and kept in memory only.

## Scriptable commands
```sh
threads feed [--pages N] [--json]
threads profile <user> [--pages N] [--json]
threads search <query> [--json]
threads post <code|url> [--depth N] [--json]   # --json prints the nested reply tree
```
`--browser offscreen` runs a real (non-headless) window off-screen if Threads starts blocking headless Chrome;
`--browser visible` shows it, useful for debugging. `--images auto|sixel|blocks|off` picks how `z` draws.

## When something breaks
- `Threads asked to log in again` → run `threads login`.
- Parse warnings save the raw page data to `%LOCALAPPDATA%\threads-tui\debug\`.
- To see what a page sends now: `npm run probe -- <url> <tag>` (writes to `fixtures/probe/`), compare with
  `FINDINGS.md`, update `src/parse.ts`, then refresh fixtures with
  `npm run fixtures -- fixtures/probe/<tag>-embedded.json <name>.json` and run `npm test`.

## Layout
- `src/browser.ts` Chrome session, tabs, GraphQL capture, login/checkpoint detection
- `src/parse.ts` payload → `Post`/`Thread` (zod-validated, tolerant of unknown fields)
- `src/store.ts` post cache and reply tree
- `src/service.ts` list/post/replies operations, one browser action at a time
- `src/image.ts` half-block preview; `src/sixel.ts` sixel encoder; `src/viewer.ts` full-screen viewer;
  `src/terminal.ts` sixel / cell-size detection
- `src/tui/` Ink screens; `src/cli.tsx` entry
