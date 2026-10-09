# Phase 0 findings (captured 2026-10-06, logged-out, headless Chrome 154)

Data source: Threads web (`www.threads.com`), Relay GraphQL. Nothing here is a public contract;
re-run `npm run probe -- <url> <tag>` when parsing breaks and diff against `test/fixtures`.

## Where data lives
- First render is usually SSR: `<script type="application/json">` blocks contain
  `require[...].__bbox.result.data`. But not always: on some loads the SSR blocks carry only `viewer` data and
  the first page of posts arrives via GraphQL right after load (seen on `/`, 2026-10-06). `Tab.load` therefore
  waits until either source yields posts.
- Pagination (scroll) fires `POST /graphql/query` with header `x-fb-friendly-name`. Response is
  `{ data: ... }` with the same node shapes as the SSR data.

## Logged-in feed (verified 2026-10-06 with a real session)
- First page: `BarcelonaFeedDirectQuery`; scroll: `BarcelonaFeedPaginationDirectQuery` (~7 threads each).
- Each scroll also fires unrelated queries (`useBarcelonaBatchedDynamicPostCountsSubscriptionQuery`, ...), so
  `loadMore` waits for a payload with unseen threads, not for any response.
- The headless renderer occasionally crashes during long scrolls (`Target crashed`); cause unknown.
  Tabs track the Playwright `crash` event and are reopened on next use.

| Page | SSR data root | Pagination query |
|---|---|---|
| `/` (logged out) | `feedData.edges[].text_post_app_thread.thread_items[]` | `BarcelonaLoggedOutFeedPaginationQuery` |
| `/@user` | `mediaData.edges[].node.thread_items[]` (+ `user`) | `BarcelonaProfileThreadsTabRefetchableDirectQuery` |
| `/search?q=` | `searchResults.edges[].node.thread.thread_items[]` | none seen (20 results, `has_next_page:false`) |
| `/post/<code>` | `media` (focal post), `media.text_post_app_info.direct_replies`, `relatedPosts` (ignore) | `BarcelonaPostPageDirectRepliesRefetchQuery` |

`/post/<code>` works without the `@username` prefix, for top-level posts and replies.

## Post node
`thread_items[].post` and reply nodes share one shape: `id`, `pk`, `code`, `user.{username,full_name,is_verified}`,
`caption.text`, `taken_at` (unix s), `like_count`, `media_type` (1 image, 2 video, 8 carousel, 19 text),
`carousel_media[]`, `text_post_app_info.{direct_reply_count,repost_count,quote_count,is_reply,reply_to_author.username,share_info.{quoted_post,reposted_post}}`.

## Reply tree
- `direct_replies.edges[].node` is `XDTTextAppThreadView`: `posts.edges[].node` is a chain where
  item 0 replies to the page's focal post and item N replies to item N-1 (checked via `reply_to_author`).
- No parent id on a reply; parentage comes from the chain position or from which page returned it.
- Deeper replies: open `/post/<reply code>`; its `direct_replies` are that reply's children.
- `direct_replies.page_info.has_next_page` + scroll fetches more top-level replies.

## Not verified yet (needs a real login)
- Logged-in home feed root/query names (parser walks any `thread_items`, so it should not depend on them).
- Whether headless Chrome with a logged-in profile is challenged. Fallback: `--browser offscreen`.
- Notifications page shape.
