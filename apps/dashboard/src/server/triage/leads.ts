import type { TweetEntities } from "../../lib/tweet-text";
import { count, text, time, triageDatabase, triageRows } from "./connection";

export interface LeadMedia {
  key: string | null;
  type: string;
  url: string | null;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  alt: string | null;
}

export interface Lead {
  id: number;
  postId: string;
  url: string;
  author: {
    id: string | null;
    handle: string | null;
    name: string | null;
    avatar: string | null;
    verified: boolean;
    verifiedType: string | null;
    followers: number | null;
    bio: string | null;
  };
  text: string;
  entities: TweetEntities | null;
  media: LeadMedia[];
  createdAt: number | null;
  metrics: { likes: number | null; reposts: number | null; replies: number | null; quotes: number | null; views: number | null; bookmarks: number | null };
  inReplyTo: string | null;
  topic: string | null;
  feature: string | null;
  replyId: number | null;
  video: { url: string; id: string | null; t: number | null; chapter: string | null; release: string | null } | null;
  videoNote: string | null;
  status: string;
  note: string | null;
  sourcedAt: number | null;
}

const LEADS_TABLE = "ardia_leads";

let leadsTableSeen = false;

async function leadsTableExists(signal?: AbortSignal) {
  if (leadsTableSeen) return true;
  const rows = await triageRows(`SELECT count() AS n FROM system.tables WHERE database = '${triageDatabase()}' AND name = '${LEADS_TABLE}'`, signal);
  leadsTableSeen = count(rows[0]?.n) > 0;
  return leadsTableSeen;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const optionalCount = (value: unknown) => (value == null ? null : count(value));

export async function loadLeads(signal?: AbortSignal): Promise<Lead[]> {
  if (!(await leadsTableExists(signal))) return [];
  const rows = await triageRows(`SELECT * EXCEPT (synced_at) FROM ${triageDatabase()}.${LEADS_TABLE} FINAL ORDER BY created_at DESC, id DESC`, signal);
  return rows.map((r) => {
    const media = parseJson<Record<string, unknown>[]>(r.media, []).map((m) => ({
      key: text(m.key),
      type: text(m.type) ?? "photo",
      url: text(m.url),
      previewUrl: text(m.preview_image_url),
      width: optionalCount(m.width),
      height: optionalCount(m.height),
      alt: text(m.alt_text),
    }));
    const videoUrl = text(r.video_url);
    return {
      id: count(r.id),
      postId: String(r.post_id),
      url: text(r.url) ?? `https://x.com/i/status/${String(r.post_id)}`,
      author: {
        id: text(r.author_id),
        handle: text(r.author_handle),
        name: text(r.author_name),
        avatar: text(r.author_avatar),
        verified: r.author_verified === true || r.author_verified === 1 || r.author_verified === "true",
        verifiedType: text(r.author_verified_type),
        followers: optionalCount(r.author_followers),
        bio: text(r.author_bio),
      },
      text: text(r.text) ?? "",
      entities: parseJson<TweetEntities | null>(r.entities, null),
      media,
      createdAt: time(r.created_at),
      metrics: {
        likes: optionalCount(r.likes),
        reposts: optionalCount(r.reposts),
        replies: optionalCount(r.replies),
        quotes: optionalCount(r.quotes),
        views: optionalCount(r.views),
        bookmarks: optionalCount(r.bookmarks),
      },
      inReplyTo: text(r.in_reply_to),
      topic: text(r.topic),
      feature: text(r.feature),
      replyId: r.reply_id == null ? null : count(r.reply_id),
      video: videoUrl
        ? { url: videoUrl, id: text(r.video_id), t: r.video_t == null ? null : Number(r.video_t), chapter: text(r.video_chapter), release: text(r.video_release) }
        : null,
      videoNote: text(r.video_note),
      status: text(r.status) ?? "new",
      note: text(r.note),
      sourcedAt: time(r.sourced_at),
    };
  });
}
