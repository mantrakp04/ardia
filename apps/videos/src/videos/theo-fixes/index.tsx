import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Freeze, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";
import { clamp, label } from "../../lib/fixes-film/look";

loadFonts();

const FPS = 30;
const INTRO = Math.round(2.2 * FPS);
const OUTRO = Math.round(2.6 * FPS);
const HOLD_IN = Math.round(0.25 * FPS);
const HOLD_OUT = Math.round(0.45 * FPS);
const DIR = "footage/theo-fixes";
const SWAP = 6;

interface Media {
  file: string;
  w: number;
  h: number;
  frames?: number;
  caption?: string;
}

interface Receipt {
  count: string;
  headline: string;
  rows: [string, string][];
}

type Side = Media | Receipt;

interface Scene {
  id: string;
  quote: string[];
  context?: string;
  title: string;
  body: string;
  layout: "side" | "stack" | "seq";
  hold?: number;
  before: Side;
  after: Side;
}

const SCENES: Scene[] = [
  {
    id: "helium",
    quote: ["No helium import?"],
    title: "Helium is found and imported",
    body: "Helium on this Mac now shows up in onboarding. Bookmarks, history, passwords, cookies and tabs come across.",
    layout: "side",
    before: { file: "helium-before.mp4", w: 880, h: 562, frames: 90, caption: "Found on this Mac: Safari" },
    after: { file: "helium-after.mp4", w: 880, h: 562, frames: 135, caption: "Found on this Mac: Safari, Helium" },
  },
  {
    id: "glass",
    quote: ["Both treatments show same thing in the onboarding"],
    title: "Glass and Classic differ",
    body: "The preview used to stay the same whichever you picked. Now it shows the style you choose.",
    layout: "side",
    before: { file: "glass-before.mp4", w: 1280, h: 740, frames: 135, caption: "Preview: 0% of pixels change" },
    after: { file: "glass-after.mp4", w: 1280, h: 740, frames: 135, caption: "Preview: a third of it changes" },
  },
  {
    id: "short",
    quote: ["Also onboarding is like 10x longer than it should be"],
    title: "Onboarding is three steps",
    body: "Where you're from, make it yours, a few last choices. Settings › General › Redo Setup… walks through it again.",
    layout: "side",
    before: { file: "short-before.mp4", w: 880, h: 562, frames: 135, caption: "8 steps, 24 screens · sped up" },
    after: { file: "short-after.mp4", w: 1764, h: 1124, frames: 136, caption: "3 steps, then Redo Setup… in Settings" },
  },
  {
    id: "suggest",
    quote: [],
    context: "A screenshot of Google's “unusual traffic” page",
    title: "Suggestions use the browser",
    body: "The likely cause, not proven: Ardia fetched search suggestions outside the browser. Now it fetches them the way Chrome does.",
    layout: "side",
    hold: 3.8,
    before: {
      count: "9",
      headline: "requests outside the browser while typing “1password”",
      rows: [
        ["User agent", "Ardia/114 CFNetwork"],
        ["Client", "client=firefox"],
        ["Cookies", "its own jar"],
      ],
    },
    after: {
      count: "0",
      headline: "requests outside the browser while typing “1password”",
      rows: [
        ["Fetched by", "the browser, as Chrome does"],
        ["Cookies", "the browser's own"],
      ],
    },
  },
  {
    id: "tabs",
    quote: ["Navigate on click down in tab bar (feels way faster)"],
    title: "Tabs switch on mouse down",
    body: "Like Chrome, Safari and Arc. From press to switch: 103 ms before, 6 ms now (median).",
    layout: "side",
    before: { file: "tabs-before.mp4", w: 702, h: 634, frames: 126, caption: "Switches on mouse up · 103 ms · slow motion" },
    after: { file: "tabs-after.mp4", w: 702, h: 634, frames: 126, caption: "Switches on mouse down · 6 ms · slow motion" },
  },
  {
    id: "urlbar",
    quote: ["Clicking url bar should open inline, only cmd+t should be the centered one imo"],
    title: "Edit the address in place",
    body: "Clicking the address bar opens it right where it is. ⌘T still opens the centred bar.",
    layout: "seq",
    before: { file: "urlbar-before.mp4", w: 1190, h: 330, frames: 57, caption: "Click: the centred bar" },
    after: { file: "urlbar-after.mp4", w: 1190, h: 330, frames: 126, caption: "Click: opens in place" },
  },
  {
    id: "newtab",
    quote: ["After making a new tab, the “new tab” is still highlighted/focused"],
    title: "The New Tab row lets go",
    body: "Open a page from a new tab and the New Tab row no longer stays highlighted.",
    layout: "side",
    before: { file: "newtab-before.mp4", w: 560, h: 360, frames: 135, caption: "New Tab stays lit" },
    after: { file: "newtab-after.mp4", w: 560, h: 360, frames: 135, caption: "Highlight clears" },
  },
  {
    id: "channel",
    quote: ["Does switching release channels work", "It did eventually but it wouldn't “check” for a bit"],
    title: "Channel switch checks now",
    body: "Pick Nightly and Ardia checks right away, says so, and offers the nightly. Before, Check Now stayed dimmed.",
    layout: "stack",
    before: { file: "channel-before.mp4", w: 1150, h: 204, frames: 135, caption: "Check Now stays dimmed" },
    after: { file: "channel-after.mp4", w: 1150, h: 204, frames: 135, caption: "Checking Nightly…, then the update" },
  },
  {
    id: "badge",
    quote: ["Notification bubbles are unreadable", "Low contrast and awful shape and size", "I just want that off"],
    title: "Unread badges: off by default",
    body: "And when you turn them on, they're calm: neutral, larger type, and legible.",
    layout: "side",
    hold: 3.8,
    before: { file: "badge-before.png", w: 784, h: 530, caption: "Red, 9 pt · contrast 3.96:1" },
    after: { file: "badge-after.png", w: 784, h: 530, caption: "Neutral, 11 pt · 6.05:1 dark, 8.33:1 light" },
  },
  {
    id: "sitemenu",
    quote: ["This opens on wrong side"],
    context: "With the sidebar on the right",
    title: "Site menu opens by its button",
    body: "With the sidebar on the right, the menu used to open at the far left. Now it opens beside the button.",
    layout: "stack",
    hold: 3.5,
    before: { file: "sitemenu-before.png", w: 2720, h: 440, caption: "Far left" },
    after: { file: "sitemenu-after.png", w: 2720, h: 440, caption: "Beside the button" },
  },
  {
    id: "search",
    quote: ["Terrible search"],
    title: "Settings search finds it",
    body: "“cli” now leads with the ardia command and opens its page. Before, it led with What's Sent.",
    layout: "side",
    before: { file: "search-before.mp4", w: 960, h: 590, frames: 105, caption: "“cli” → What's Sent" },
    after: { file: "search-after.mp4", w: 960, h: 590, frames: 105, caption: "“cli” → the ardia command" },
  },
  {
    id: "little",
    quote: ["Clicking links in other apps opens little arc even though i have setting off"],
    title: "One Little Ardia switch",
    body: "Links went where Settings said; Settings pointed at the wrong switch. Now there's one, and “little arc” finds it.",
    layout: "seq",
    before: { file: "little-before.mp4", w: 1320, h: 700, frames: 96, caption: "That switch is off; the menu above still says Little Ardia" },
    after: { file: "little-after.mp4", w: 1320, h: 700, frames: 96, caption: "“little arc” finds the one switch, and off means off" },
  },
];

const isMedia = (s: Side): s is Media => "file" in s;
const framesOf = (s: Side, hold: number) => (isMedia(s) && s.frames ? s.frames : Math.round(hold * FPS));

function quoteFrames(scene: Scene) {
  const words = [...scene.quote, scene.context ?? ""].join(" ").split(/\s+/).filter(Boolean).length;
  return Math.round(Math.min(2.2, 0.95 + 0.085 * words) * FPS);
}

function playFrames(scene: Scene) {
  const hold = scene.hold ?? 4;
  const b = framesOf(scene.before, hold);
  const a = framesOf(scene.after, hold);
  return scene.layout === "seq" ? b + a : Math.max(b, a);
}

const AREA = { top: 318, bottom: 1030, left: 60, right: 1860 };
const GAP = 60;

type Box = { left: number; top: number; w: number; h: number };

function fit(w: number, h: number, maxW: number, maxH: number) {
  const k = Math.min(maxW / w, maxH / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

function boxes(scene: Scene): [Box, Box] {
  const ref = isMedia(scene.before) ? scene.before : isMedia(scene.after) ? scene.after : { w: 860, h: 560 };
  const caption = 46;
  const fullW = AREA.right - AREA.left;
  const fullH = AREA.bottom - AREA.top - caption;
  if (scene.layout === "seq") {
    const s = fit(ref.w, ref.h, fullW, fullH);
    const b = { left: (1920 - s.w) / 2, top: AREA.top + (fullH - s.h) / 2, ...s };
    return [b, b];
  }
  if (scene.layout === "stack") {
    const s = fit(ref.w, ref.h, fullW, (fullH - caption - GAP) / 2);
    const top = AREA.top + (fullH - caption - GAP - 2 * s.h) / 2;
    const left = (1920 - s.w) / 2;
    return [
      { left, top, ...s },
      { left, top: top + s.h + caption + GAP, ...s },
    ];
  }
  const colW = (fullW - GAP) / 2;
  const s = fit(ref.w, ref.h, colW, fullH);
  const top = AREA.top + (fullH - s.h) / 2;
  return [
    { left: AREA.left + (colW - s.w) / 2, top, ...s },
    { left: AREA.left + colW + GAP + (colW - s.w) / 2, top, ...s },
  ];
}

const poster: CSSProperties = {
  fontFamily: font.poster,
  fontWeight: 850,
  fontStretch: "75%",
  textTransform: "uppercase",
  letterSpacing: "0.01em",
  color: color.ink,
};

function useRise() {
  const frame = useCurrentFrame();
  return (delay: number, distance = 20) => ({
    opacity: interpolate(frame, [delay, delay + 14], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 20], [distance, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
}

function Chip({ after }: { after: boolean }) {
  return (
    <div
      style={{
        ...label,
        fontSize: 19,
        fontWeight: 620,
        color: after ? color.paper : color.ink,
        background: after ? color.blue : "transparent",
        boxShadow: after ? "none" : `inset 0 0 0 2px ${color.ink}`,
        padding: "6px 12px 5px",
        borderRadius: 8,
      }}
    >
      {after ? "After" : "Before"}
    </div>
  );
}

function Playing({ media, style }: { media: Media; style: CSSProperties }) {
  const src = staticFile(`${DIR}/${media.file}`);
  if (!media.frames) return <Img src={src} style={style} />;
  const video = <OffthreadVideo src={src} muted style={style} />;
  return (
    <>
      <Sequence durationInFrames={media.frames} layout="none">
        {video}
      </Sequence>
      <Sequence from={media.frames} layout="none">
        <Freeze frame={media.frames - 1}>{video}</Freeze>
      </Sequence>
    </>
  );
}

function ReceiptCard({ receipt, after }: { receipt: Receipt; after: boolean }) {
  const ink = after ? color.blue : color.stamp;
  return (
    <div style={{ position: "absolute", inset: 0, padding: "54px 60px", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
        <div style={{ ...poster, fontSize: 230, lineHeight: 0.8, color: ink }}>{receipt.count}</div>
        <div style={{ fontFamily: font.serif, fontSize: 34, lineHeight: 1.2, color: color.ink, maxWidth: 470 }}>{receipt.headline}</div>
      </div>
      <div style={{ marginTop: "auto", borderTop: `2px solid ${color.rule}` }}>
        {receipt.rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", borderBottom: `2px solid ${color.rule}` }}>
            <div style={{ ...label, fontSize: 20 }}>{k}</div>
            <div style={{ fontFamily: font.mono, fontSize: 24, fontStretch: "87.5%", color: color.ink }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ side, box, after, from, until }: { side: Side; box: Box; after: boolean; from: number; until?: number }) {
  const frame = useCurrentFrame();
  const gone = until === undefined ? 1 : interpolate(frame, [until, until + SWAP], [1, 0], clamp);
  const shown = interpolate(frame, [from, from + 10], [0, 1], clamp) * gone;
  const panel: CSSProperties = {
    position: "absolute",
    left: box.left,
    top: box.top,
    width: box.w,
    height: box.h,
    overflow: "hidden",
    borderRadius: 18,
    background: isMedia(side) ? color.night : color.paperDeep,
    boxShadow: "0 30px 70px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
  };
  const caption = isMedia(side) ? side.caption : undefined;
  return (
    <div style={{ opacity: shown }}>
      <div style={{ position: "absolute", left: box.left, top: box.top - 48 }}>
        <Chip after={after} />
      </div>
      <div style={panel}>
        {isMedia(side) ? (
          <Sequence from={from} layout="none">
            <Playing media={side} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
          </Sequence>
        ) : (
          <ReceiptCard receipt={side} after={after} />
        )}
      </div>
      {caption ? (
        <div style={{ ...label, position: "absolute", left: box.left, top: box.top + box.h + 16, width: box.w, fontSize: 19, color: after ? color.blue : color.ink2 }}>
          {caption}
        </div>
      ) : null}
    </div>
  );
}

function QuoteCard({ scene, index, length }: { scene: Scene; index: number; length: number }) {
  const frame = useCurrentFrame();
  const rise = useRise();
  const out = interpolate(frame, [length - 8, length], [1, 0], clamp);
  const lines = scene.quote;
  const size = lines.length > 2 ? 66 : lines.join(" ").length > 60 ? 70 : 88;
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 150, paddingRight: 150, opacity: out }}>
      <div style={{ ...label, fontSize: 22, color: color.blue, ...rise(0) }}>
        Theo · {String(index + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")}
      </div>
      {scene.context ? (
        <div style={{ marginTop: 26, fontFamily: font.serif, fontSize: lines.length ? 36 : 64, lineHeight: 1.2, color: color.ink2, ...rise(3) }}>
          {lines.length ? `${scene.context}:` : `(${scene.context})`}
        </div>
      ) : null}
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: size * 0.32 }}>
        {lines.map((line, i) => (
          <div key={line} style={{ position: "relative", fontFamily: font.serif, fontStyle: "italic", fontSize: size, lineHeight: 1.12, color: color.ink, maxWidth: 1560, ...rise(4 + i * 4) }}>
            <span style={{ position: "absolute", left: -0.5 * size, color: color.stamp }}>“</span>
            {line}
            <span style={{ color: color.stamp }}>”</span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Shot({ scene, index, play }: { scene: Scene; index: number; play: number }) {
  const frame = useCurrentFrame();
  const length = HOLD_IN + play + HOLD_OUT;
  const fade = interpolate(frame, [0, 8, length - 8, length], [0, 1, 1, 0], clamp);
  const [b, a] = boxes(scene);
  const hold = scene.hold ?? 4;
  const beforeFrames = framesOf(scene.before, hold);
  const seqSwap = HOLD_IN + beforeFrames;
  const showBefore = scene.layout !== "seq" || frame < seqSwap + SWAP;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: AREA.left, top: 52, right: 60, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>Theo's list · fixed on main</div>
        <div style={{ ...label, color: color.blue }}>
          {String(index + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")}
        </div>
      </div>
      <div style={{ ...poster, position: "absolute", left: AREA.left, top: 98, width: 900, fontSize: 60, lineHeight: 0.96 }}>{scene.title}</div>
      <div style={{ position: "absolute", left: 1000, top: 100, width: 860, fontFamily: font.serif, fontSize: 28, lineHeight: 1.3, color: color.ink }}>{scene.body}</div>
      {showBefore ? <Panel side={scene.before} box={b} after={false} from={HOLD_IN} until={scene.layout === "seq" ? seqSwap : undefined} /> : null}
      {scene.layout === "seq" ? (
        frame >= seqSwap ? (
          <Sequence from={seqSwap} layout="none">
            <Panel side={scene.after} box={a} after from={SWAP} />
          </Sequence>
        ) : null
      ) : (
        <Panel side={scene.after} box={a} after from={HOLD_IN} />
      )}
    </AbsoluteFill>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const rise = useRise();
  const out = interpolate(frame, [INTRO - 10, INTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 150, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(2) }}>For Theo · before and after</div>
      <div style={{ ...poster, marginTop: 20, fontSize: 210, lineHeight: 0.9, ...rise(6, 28) }}>Theo's list</div>
      <div style={{ marginTop: 26, fontFamily: font.serif, fontSize: 40, color: color.ink2, ...rise(14) }}>Twelve complaints. Twelve fixes.</div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 330, width: 420, height: 420, ...rise(10) }} />
    </AbsoluteFill>
  );
}

function Outro() {
  const rise = useRise();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: 210, height: 210, ...rise(0) }} />
      <div style={{ ...poster, marginTop: 34, fontSize: 96, lineHeight: 1, ...rise(6) }}>All in the next nightly.</div>
      <div style={{ ...label, marginTop: 26, fontSize: 24, color: color.blue, ...rise(14) }}>Thanks, Theo</div>
    </AbsoluteFill>
  );
}

const quotes = SCENES.map(quoteFrames);
const plays = SCENES.map(playFrames);
const lengths = SCENES.map((_, i) => quotes[i]! + HOLD_IN + plays[i]! + HOLD_OUT);
const starts = lengths.map((_, i) => INTRO + lengths.slice(0, i).reduce((x, y) => x + y, 0));
const total = INTRO + lengths.reduce((x, y) => x + y, 0) + OUTRO;

export const meta = { width: 1920, height: 1080, fps: FPS, durationInFrames: total };

export default function TheoFixes(): ReactNode {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {SCENES.map((scene, i) => (
        <Sequence key={scene.id} from={starts[i]} durationInFrames={lengths[i]}>
          <Sequence durationInFrames={quotes[i]}>
            <QuoteCard scene={scene} index={i} length={quotes[i]!} />
          </Sequence>
          <Sequence from={quotes[i]} durationInFrames={lengths[i]! - quotes[i]!}>
            <Shot scene={scene} index={i} play={plays[i]!} />
          </Sequence>
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
