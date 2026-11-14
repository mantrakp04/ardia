import { BarChart3, Bookmark, Heart, MessageCircle, Play, Repeat2 } from "lucide-react";
import { useState } from "react";
import { formatCount } from "@/lib/format";
import { splitReplyingTo, tweetSegments, type TweetEntities } from "@/lib/tweet-text";
import { cn } from "@/lib/utils";
import type { LeadMedia } from "@/server/triage/leads";

export interface TweetCardPost {
  url: string;
  author: { handle: string | null; name: string | null; avatar: string | null; verified: boolean; verifiedType: string | null; followers: number | null };
  text: string;
  entities: TweetEntities | null;
  media: LeadMedia[];
  createdAt: number | null;
  inReplyTo: string | null;
  metrics: { likes: number | null; reposts: number | null; replies: number | null; views: number | null; bookmarks: number | null };
}

const BADGE_COLOR: Record<string, string> = { business: "#e2b719", government: "#829aab" };

function VerifiedBadge({ type }: { type: string | null }) {
  const label = type === "business" ? "Verified organization" : type === "government" ? "Government account" : "Verified account";
  return (
    <svg viewBox="0 0 22 22" role="img" aria-label={label} className="size-[15px] shrink-0">
      <title>{label}</title>
      <path
        fill={BADGE_COLOR[type ?? ""] ?? "#1d9bf0"}
        d="M20.4 11c0-1.3-.8-2.4-2-2.9.5-1.2.2-2.6-.7-3.5-.9-.9-2.3-1.2-3.5-.7C13.7 2.7 12.5 2 11.2 2S8.7 2.7 8.2 3.9C7 3.4 5.6 3.7 4.7 4.6c-.9.9-1.2 2.3-.7 3.5C2.8 8.6 2 9.7 2 11s.8 2.4 2 2.9c-.5 1.2-.2 2.6.7 3.5.9.9 2.3 1.2 3.5.7.5 1.2 1.7 1.9 3 1.9s2.5-.7 3-1.9c1.2.5 2.6.2 3.5-.7.9-.9 1.2-2.3.7-3.5 1.2-.5 2-1.6 2-2.9z"
      />
      <path fill="#fff" d="M9.6 14.9 6.4 11.7l1.3-1.3 1.9 1.9 4.7-4.8 1.3 1.3z" />
    </svg>
  );
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.08 4.13H5.12z" />
    </svg>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground uppercase">
        {name.slice(0, 1)}
      </span>
    );
  }
  return <img src={src} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-10 shrink-0 rounded-full bg-muted object-cover" />;
}

const postTime = (ms: number) =>
  `${new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

function relativeTime(ms: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MediaGrid({ media, url }: { media: LeadMedia[]; url: string }) {
  if (!media.length) return null;
  const shown = media.slice(0, 4);
  return (
    <div className={cn("mt-2.5 grid gap-0.5 overflow-hidden rounded-2xl border", shown.length > 1 && "grid-cols-2", shown.length > 2 && "grid-rows-2")}>
      {shown.map((m, i) => {
        const src = m.type === "photo" ? m.url : (m.previewUrl ?? m.url);
        const tall = shown.length === 3 && i === 0;
        return (
          <a
            key={m.key ?? i}
            href={m.type === "photo" && m.url ? m.url : url}
            target="_blank"
            rel="noreferrer"
            className={cn("relative block bg-muted", tall && "row-span-2", shown.length === 1 ? "max-h-[360px]" : "aspect-[16/10]", tall && "aspect-auto")}
          >
            {src ? <img src={src} alt={m.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" className="size-full max-h-[360px] object-cover" /> : null}
            {m.type !== "photo" ? (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white ring-2 ring-white/80">
                  <Play className="ml-0.5 size-5 fill-current" aria-hidden />
                </span>
                {m.type === "animated_gif" ? <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1 text-[10px] font-bold text-white">GIF</span> : null}
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

function Metric({ icon: Icon, value, label }: { icon: typeof Heart; value: number | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={value == null ? undefined : `${value.toLocaleString()} ${label}`}>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{value == null ? "–" : formatCount(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function TweetCard({ post, className }: { post: TweetCardPost; className?: string }) {
  const handle = post.author.handle ?? "unknown";
  const name = post.author.name ?? handle;
  const profile = `https://x.com/${handle}`;
  const { replyingTo, body } = splitReplyingTo(post.text, post.inReplyTo != null);
  const segments = tweetSegments(body, post.entities);
  return (
    <article className={cn("rounded-xl border bg-background px-3.5 pt-3 pb-2.5 text-foreground", className)} aria-label={`Post by @${handle}`}>
      <header className="flex items-start gap-2.5">
        <a href={profile} target="_blank" rel="noreferrer" className="shrink-0">
          <Avatar src={post.author.avatar} name={name} />
        </a>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex min-w-0 items-center gap-1">
            <a href={profile} target="_blank" rel="noreferrer" className="truncate text-[14px] font-bold hover:underline">
              {name}
            </a>
            {post.author.verified ? <VerifiedBadge type={post.author.verifiedType} /> : null}
          </div>
          <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
            <a href={profile} target="_blank" rel="noreferrer" className="truncate">
              @{handle}
            </a>
            {post.createdAt ? (
              <>
                <span aria-hidden>·</span>
                <a href={post.url} target="_blank" rel="noreferrer" className="shrink-0 hover:underline" title={postTime(post.createdAt)}>
                  <time dateTime={new Date(post.createdAt).toISOString()}>{relativeTime(post.createdAt)}</time>
                </a>
              </>
            ) : null}
            {post.author.followers != null ? <span className="ml-1 shrink-0 text-[11px]">{formatCount(post.author.followers)} followers</span> : null}
          </div>
        </div>
        <a href={post.url} target="_blank" rel="noreferrer" aria-label="Open on X" className="shrink-0 text-foreground/80 hover:text-foreground">
          <XMark className="size-4" />
        </a>
      </header>
      {replyingTo.length ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Replying to{" "}
          {replyingTo.map((h, i) => (
            <span key={h}>
              {i ? " " : ""}
              <a href={`https://x.com/${h}`} target="_blank" rel="noreferrer" className="text-[#1d9bf0] hover:underline">
                @{h}
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <p className="mt-1.5 text-[14.5px] leading-[1.4] break-words whitespace-pre-wrap">
        {segments.map((s, i) =>
          s.kind === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <a key={i} href={s.href} target="_blank" rel="noreferrer" className="text-[#1d9bf0] hover:underline">
              {s.text}
            </a>
          ),
        )}
      </p>
      <MediaGrid media={post.media} url={post.url} />
      {post.createdAt ? (
        <a href={post.url} target="_blank" rel="noreferrer" className="mt-2.5 block text-[13px] text-muted-foreground hover:underline">
          {postTime(post.createdAt)}
        </a>
      ) : null}
      <footer className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-2 text-[12.5px] text-muted-foreground">
        <Metric icon={MessageCircle} value={post.metrics.replies} label="replies" />
        <Metric icon={Repeat2} value={post.metrics.reposts} label="reposts" />
        <Metric icon={Heart} value={post.metrics.likes} label="likes" />
        <Metric icon={BarChart3} value={post.metrics.views} label="views" />
        <Metric icon={Bookmark} value={post.metrics.bookmarks} label="bookmarks" />
      </footer>
    </article>
  );
}
