export interface TweetUrlEntity {
  url: string;
  expanded_url?: string;
  display_url?: string;
  media_key?: string;
}

export interface TweetEntities {
  urls?: TweetUrlEntity[];
}

export type TweetSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "mention"; text: string; href: string }
  | { kind: "hashtag"; text: string; href: string };

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

export const decodeTweetText = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m] ?? m);

const isMediaLink = (entity: TweetUrlEntity) => Boolean(entity.media_key) || /\/(photo|video)\/\d+$/.test(entity.expanded_url ?? "");

export function splitReplyingTo(text: string, isReply: boolean): { replyingTo: string[]; body: string } {
  if (!isReply) return { replyingTo: [], body: text };
  const match = /^(?:@\w{1,15}\s+)+/.exec(text);
  if (!match) return { replyingTo: [], body: text };
  return { replyingTo: match[0].trim().split(/\s+/).map((h) => h.slice(1)), body: text.slice(match[0].length) };
}

export function tweetSegments(raw: string, entities: TweetEntities | null | undefined, hideMediaLinks = true): TweetSegment[] {
  const text = decodeTweetText(raw);
  const urls = new Map((entities?.urls ?? []).map((e) => [e.url, e]));
  const segments: TweetSegment[] = [];
  const token = /(https?:\/\/t\.co\/\w+|https?:\/\/[^\s]+)|(@\w{1,15})|(#[\p{L}\p{N}_]+)/gu;
  let last = 0;
  for (const m of text.matchAll(token)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    last = start + m[0].length;
    if (m[1]) {
      const entity = urls.get(m[1]);
      if (entity && hideMediaLinks && isMediaLink(entity)) continue;
      const href = entity?.expanded_url ?? m[1];
      segments.push({ kind: "link", text: entity?.display_url ?? href.replace(/^https?:\/\/(www\.)?/, ""), href });
    } else if (m[2]) {
      segments.push({ kind: "mention", text: m[2], href: `https://x.com/${m[2].slice(1)}` });
    } else if (m[3]) {
      segments.push({ kind: "hashtag", text: m[3], href: `https://x.com/hashtag/${encodeURIComponent(m[3].slice(1))}` });
    }
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  const tail = segments.at(-1);
  if (tail?.kind === "text") tail.text = tail.text.replace(/\s+$/, "");
  return segments.filter((s) => s.kind !== "text" || s.text.length > 0);
}

export function videoTimestampLabel(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
