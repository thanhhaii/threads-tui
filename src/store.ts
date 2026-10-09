import type { Post, Thread } from "./model.ts";
import type { PostPage } from "./parse.ts";

interface ReplyState {
  childIds: string[];
  /** true once this post's own page was fetched, so childIds is the server's first page */
  loaded: boolean;
  hasMore: boolean;
}

export interface TreeRow {
  post: Post;
  depth: number;
  expanded: boolean;
  /** children exist on the server that are not in the store yet */
  canLoad: boolean;
}

export class Store {
  private readonly posts = new Map<string, Post>();
  private readonly replies = new Map<string, ReplyState>();

  get(id: string): Post | undefined {
    return this.posts.get(id);
  }

  findByCode(code: string): Post | undefined {
    for (const p of this.posts.values()) if (p.code === code) return p;
    return undefined;
  }

  putPosts(posts: Post[]): void {
    for (const p of posts) this.posts.set(p.id, p);
  }

  threadPosts(t: Thread): Post[] {
    return t.postIds.flatMap((id) => this.posts.get(id) ?? []);
  }

  /** Merge a post page; chains place each reply under the previous chain item. */
  putPostPage(page: PostPage): void {
    this.putPosts(page.posts);
    for (const block of page.replies) {
      const parent = this.state(block.parentId);
      parent.loaded = true;
      parent.hasMore = block.hasMore;
      for (const chain of block.chains) {
        let parentId = block.parentId;
        for (const p of chain) {
          const s = this.state(parentId);
          if (!s.childIds.includes(p.id)) s.childIds.push(p.id);
          parentId = p.id;
        }
      }
    }
  }

  childIds(id: string): string[] {
    return this.replies.get(id)?.childIds ?? [];
  }

  isLoaded(id: string): boolean {
    return this.replies.get(id)?.loaded ?? false;
  }

  hasMoreReplies(id: string): boolean {
    return this.replies.get(id)?.hasMore ?? false;
  }

  /** Flatten the reply tree under `rootId` into visible rows, depth-first. */
  tree(rootId: string, expanded: ReadonlySet<string>): TreeRow[] {
    const rows: TreeRow[] = [];
    const walk = (id: string, depth: number) => {
      for (const cid of this.childIds(id)) {
        const post = this.posts.get(cid);
        if (!post) continue;
        const known = this.childIds(cid).length;
        const isOpen = expanded.has(cid);
        rows.push({
          post,
          depth,
          expanded: isOpen,
          canLoad: !this.isLoaded(cid) && post.replyCount > known,
        });
        if (isOpen) walk(cid, depth + 1);
      }
    };
    walk(rootId, 0);
    return rows;
  }

  private state(id: string): ReplyState {
    let s = this.replies.get(id);
    if (!s) {
      s = { childIds: [], loaded: false, hasMore: false };
      this.replies.set(id, s);
    }
    return s;
  }
}
