export type MediaKind = "none" | "image" | "video" | "carousel";

/** One displayable picture; for videos this is the poster frame. */
export interface MediaImage {
  /** ~640px wide, for inline previews */
  url: string;
  /** largest available, for the full-screen viewer */
  fullUrl: string;
  width: number;
  height: number;
  video: boolean;
}

export interface Author {
  id: string;
  username: string;
  fullName: string;
  verified: boolean;
}

export interface Post {
  id: string;
  code: string;
  url: string;
  author: Author;
  text: string;
  createdAt: number;
  likeCount: number;
  replyCount: number;
  repostCount: number;
  quoteCount: number;
  media: MediaKind;
  mediaCount: number;
  images: MediaImage[];
  isReply: boolean;
  replyTo?: string;
  link?: string;
  quoted?: Post;
  repostedBy?: Author;
}

/** One feed entry: a post plus any context posts Threads groups with it. */
export interface Thread {
  id: string;
  postIds: string[];
}

export type ListSource =
  | { kind: "feed" }
  | { kind: "profile"; username: string }
  | { kind: "search"; query: string };

export interface ParseIssue {
  where: string;
  message: string;
}
