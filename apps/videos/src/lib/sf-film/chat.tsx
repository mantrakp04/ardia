import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { clamp, easeInOut, easeOut, mix, Pointer, seg, sine, springAt } from "./kit";
import { PEOPLE } from "./plan";

const SF = '-apple-system, "SF Pro Text", "Helvetica Neue", sans-serif';

export type Person = "Priya" | "Tomás" | "Jun" | "Ava" | "Maya" | "Leo" | "Kai" | "Noor";
const COLOR: Record<Person, string> = {
  Priya: PEOPLE.priya.color, Tomás: PEOPLE.tomas.color, Jun: PEOPLE.jun.color, Ava: PEOPLE.ava.color,
  Maya: PEOPLE.maya.color, Leo: PEOPLE.leo.color, Kai: PEOPLE.kai.color, Noor: PEOPLE.noor.color,
};
export interface Link {
  host: string;
  title: string;
}
export interface Msg {
  at: number;
  who: Person;
  text?: string;
  link?: Link;
  me?: boolean;
}
export interface Thread {
  id: string;
  title: string;
  members: Person[];
  links: number;
  messages: Msg[];
  history?: Msg[];
}

const L = (host: string, title: string): Link => ({ host, title });
export const LINKS = {
  canopy: L("canopy.example", "Canopy & Street Heat"),
  citydata: L("citydata.example", "Street Tree Census"),
  course: L("course.example", "GEOG 341 · Week 6"),
  library: L("library.example", "The Shaded City"),
  heatmap: L("heatmap.example", "Summer Heat Map"),
  survey: L("survey.example", "Field Survey Form"),
  pressroom: L("pressroom.example", "Kite Press Kit"),
  roadmap: L("roadmap.example", "Q4 Launch Roadmap"),
  mockups: L("mockups.example", "Onboarding Mockups"),
  hostel: L("hostel.example", "Harbour Hostel"),
  ferry: L("ferry.example", "Island Ferry Times"),
};

const old = (n: number): Msg[] => Array.from({ length: n }, (_, i) => {
  const pool: Msg[] = [
    { at: -10, who: "Jun", link: LINKS.library },
    { at: -10, who: "Tomás", text: "this one?" },
    { at: -10, who: "Ava", link: LINKS.course },
    { at: -10, who: "Priya", text: "no wait", me: true },
    { at: -10, who: "Jun", link: LINKS.canopy },
    { at: -10, who: "Ava", text: "link pls" },
    { at: -10, who: "Tomás", link: LINKS.citydata },
  ];
  return pool[i % pool.length];
});

export const THREADS: Thread[] = [
  {
    id: "thesis", title: "thesis gc 🌳", members: ["Priya", "Tomás", "Jun", "Ava"], links: 46,
    history: old(16),
    messages: [
      { at: -4, who: "Jun", link: LINKS.canopy },
      { at: -3, who: "Ava", text: "is this the one for the lit review" },
      { at: -2, who: "Tomás", link: LINKS.citydata },
      { at: -1, who: "Ava", text: "wait which link??" },
      { at: 0.6, who: "Priya", text: "no the OTHER heat map", me: true },
      { at: 1.3, who: "Jun", link: LINKS.heatmap },
      { at: 2.0, who: "Ava", text: "can someone resend 🙏" },
      { at: 2.8, who: "Tomás", text: "scroll up lol" },
      { at: 12.8, who: "Jun", text: "found it?" },
      { at: 13.5, who: "Ava", text: "which one lol" },
    ],
  },
  {
    id: "launch", title: "kite launch 🚀", members: ["Maya", "Leo"], links: 23,
    messages: [
      { at: -3, who: "Leo", text: "where’s the press kit link" },
      { at: -2, who: "Maya", link: LINKS.pressroom },
      { at: -1, who: "Leo", text: "no the OTHER one" },
      { at: 9.5, who: "Maya", link: LINKS.roadmap },
      { at: 10.3, who: "Leo", text: "can u resend the mockups 🙏" },
      { at: 11.1, who: "Priya", text: "it’s in the doc", me: true },
      { at: 11.8, who: "Leo", text: "what doc 💀" },
    ],
  },
  {
    id: "trip", title: "port sela trip 🏝️", members: ["Kai", "Noor"], links: 31,
    messages: [
      { at: -3, who: "Noor", text: "ferry times??" },
      { at: -2, who: "Kai", link: LINKS.hostel },
      { at: -1, who: "Noor", text: "which hostel link" },
      { at: 12.6, who: "Kai", link: LINKS.ferry },
      { at: 13.4, who: "Noor", text: "it’s in here somewhere" },
      { at: 14.2, who: "Kai", text: "scroll up 😭" },
      { at: 15.0, who: "Noor", text: "resend?" },
    ],
  },
  { id: "bio", title: "BIO 210 study 🧪", members: ["Ava", "Jun"], links: 12, messages: [{ at: -1, who: "Jun", text: "quiz link anyone?" }] },
];

const BUBBLE = 40;
const NAME_H = 34;
const TEXT_H = BUBBLE * 1.25 + 30;
const RUN_GAP = 26;
const IN_RUN = 6;
const READ_H = 34;
const STAMP_H = 64;
const HEADER = 132;
const COMPOSE = 112;
const AVATAR = 52;
const INSET = 36;
const SENT = "#1F8BFF";
const RECEIVED = "#E9E9EB";
const PAPER = "#FFFFFF";
const SIDEBAR = "#EDEDF0";
const GREY = "#8E8E93";
const SELECTED = "#1A82FB";

function Sym({ name, size, color, style }: { name: string; size: number; color: string; style?: CSSProperties }) {
  const v = parseInt(color.slice(1, 3), 16);
  return <Img src={staticFile(`brand/sf/sym-${name}.png`)} style={{ width: size, height: size, objectFit: "contain", opacity: 1 - v / 255, flexShrink: 0, ...style }} />;
}

function Tail({ me }: { me: boolean }) {
  const color = me ? SENT : RECEIVED;
  const side = me ? "right" : "left";
  return (
    <>
      <div style={{ position: "absolute", bottom: 0, [side]: -10, width: 30, height: 32, backgroundColor: color, [me ? "borderBottomLeftRadius" : "borderBottomRightRadius"]: 24 }} />
      <div style={{ position: "absolute", bottom: 0, [side]: -24, width: 24, height: 34, backgroundColor: PAPER, [me ? "borderBottomLeftRadius" : "borderBottomRightRadius"]: 16 }} />
    </>
  );
}

function Bubble({ m, tail }: { m: Msg; tail: boolean }) {
  return (
    <div style={{ position: "relative", padding: "15px 28px", borderRadius: 42, fontSize: BUBBLE, lineHeight: 1.25, maxWidth: 820, backgroundColor: m.me ? SENT : RECEIVED, color: m.me ? "#FFFFFF" : "#000000", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
      {tail ? <Tail me={!!m.me} /> : null}
      <span style={{ position: "relative" }}>{m.text}</span>
    </div>
  );
}

export const CARD_H = 300;
export function LinkCard({ link, width = 600 }: { link: Link; width?: number }) {
  const k = width / 600;
  return (
    <div style={{ width, height: CARD_H * k, boxSizing: "border-box", borderRadius: 34 * k, overflow: "hidden", backgroundColor: RECEIVED, fontFamily: SF }}>
      <div style={{ height: 204 * k, overflow: "hidden", backgroundColor: "#D8D8DC" }}>
        <Img src={staticFile(`footage/sf-pages/${link.host}.jpg`)} style={{ width: "100%", display: "block" }} />
      </div>
      <div style={{ padding: `${16 * k}px ${24 * k}px 0` }}>
        <div style={{ fontSize: 30 * k, fontWeight: 600, color: "#000000", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-0.01em" }}>{link.title}</div>
        <div style={{ fontSize: 24 * k, color: GREY, marginTop: 4 * k }}>{link.host}</div>
      </div>
    </div>
  );
}

function Face({ who, size, ring = PAPER }: { who: Person; size: number; ring?: string }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLOR[who], boxShadow: `0 0 0 ${Math.max(2, size * 0.05)}px ${ring}`, color: "#fff", fontWeight: 600, fontSize: size * 0.44, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {who[0]}
    </div>
  );
}

function GroupAvatar({ people, size, ring }: { people: Person[]; size: number; ring?: string }) {
  const small = size * 0.56;
  const spots = [[0.02, 0.06], [0.42, 0.02], [0.2, 0.42]];
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {people.slice(0, 3).map((n, i) => (
        <div key={n} style={{ position: "absolute", left: spots[i][0] * size, top: spots[i][1] * size }}>
          <Face who={n} size={small} ring={ring} />
        </div>
      ))}
    </div>
  );
}

export interface ChatState {
  thread: number;
  switchAt: number;
  scroll: number;
  links: number;
  panel?: number;
}

type Item = { kind: "stamp"; text: [string, string]; top: number; h: number } | { kind: "msg"; m: Msg; name: boolean; tail: boolean; face: boolean; read: boolean; top: number; h: number };
function stack(history: Msg[], shown: Msg[], fresh: number) {
  const items: Item[] = [];
  let y = 0;
  const push = (it: Item) => {
    items.push(it);
    y += it.h;
  };
  const all = [...history, ...shown];
  const lastSent = all.reduce((at, m, i) => (m.me ? i : at), -1);
  const today = history.length + Math.max(0, fresh);
  if (history.length) push({ kind: "stamp", text: ["Yesterday", "9:14 PM"], top: y, h: STAMP_H });
  all.forEach((m, i) => {
    if (i === today) push({ kind: "stamp", text: ["Today", "4:02 PM"], top: y, h: STAMP_H });
    const prev = all[i - 1];
    const next = all[i + 1];
    const first = !prev || prev.who !== m.who || i === today;
    const last = !next || next.who !== m.who || i + 1 === today;
    const name = !m.me && first;
    const read = i === lastSent;
    const h = (name ? NAME_H : 0) + (m.link ? CARD_H : TEXT_H) + (read ? READ_H : 0) + (last ? RUN_GAP : IN_RUN);
    push({ kind: "msg", m, name, tail: last && !m.link, face: !m.me && last, read, top: y, h });
  });
  return { items, total: y };
}

export const PANEL_LINKS = [LINKS.canopy, LINKS.citydata, LINKS.course, LINKS.library, LINKS.heatmap, LINKS.survey];
const PANEL_TOP = 164;
export function panelLayout(width: number, port: boolean) {
  const list = port ? 0 : 440;
  const cols = port ? 2 : 3;
  const pad = 36;
  const gap = 24;
  const w = (width - list - pad * 2 - gap * (cols - 1)) / cols;
  const h = (w * CARD_H) / 600;
  return PANEL_LINKS.map((link, i) => ({ link, x: list + pad + (i % cols) * (w + gap), y: HEADER + PANEL_TOP + Math.floor(i / cols) * (h + gap), w, h }));
}
export const badgeCenter = (width: number) => ({ x: width - INSET - 22, y: HEADER / 2 });

function LinksPanel({ width, port, open, count, hide }: { width: number; port: boolean; open: number; count: number; hide: string[] }) {
  const list = port ? 0 : 440;
  const cards = panelLayout(width, port);
  const tabs = ["Photos", "Links", "Documents"];
  return (
    <div style={{ position: "absolute", left: list, right: 0, top: HEADER, bottom: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundColor: PAPER, translate: `${(1 - open) * 104}% 0`, boxShadow: "-12px 0 30px rgba(0,0,0,0.08)", borderLeft: "1px solid #E5E5EA" }}>
        <div style={{ position: "absolute", left: "50%", top: 24, translate: "-50% 0", display: "flex", padding: 4, borderRadius: 14, backgroundColor: "#E3E3E8" }}>
          {tabs.map((t) => (
            <div key={t} style={{ padding: "8px 30px", borderRadius: 11, fontSize: 24, fontWeight: t === "Links" ? 600 : 500, color: "#1C1C1E", backgroundColor: t === "Links" ? "#FFFFFF" : "transparent", boxShadow: t === "Links" ? "0 1px 3px rgba(0,0,0,0.12)" : undefined }}>{t}</div>
          ))}
        </div>
        <div style={{ position: "absolute", left: INSET, top: 96, display: "flex", alignItems: "baseline", gap: 14 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: "#000000", letterSpacing: "-0.02em" }}>Links</div>
          <div style={{ fontSize: 26, color: GREY }}>{count}</div>
        </div>
        {cards.map((c) => (
          <div key={c.link.host} style={{ position: "absolute", left: c.x - list, top: c.y - HEADER, opacity: hide.includes(c.link.host) ? 0 : 1 }}>
            <LinkCard link={c.link} width={c.w} />
          </div>
        ))}
      </div>
    </div>
  );
}

const Lights = ({ style }: { style?: CSSProperties }) => (
  <div style={{ display: "flex", gap: 12, ...style }}>
    {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)" }} />)}
  </div>
);

const STAMPS = ["4:02 PM", "3:47 PM", "Yesterday", "Tuesday"];
function Sidebar({ b, state, latest }: { b: number; state: ChatState; latest?: Msg }) {
  return (
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 440, backgroundColor: SIDEBAR, backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.35), rgba(255,255,255,0))", borderRight: "1px solid #DCDCE0", padding: "26px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 8px 24px" }}>
        <Lights />
        <Sym name="square.and.pencil" size={30} color="#6C6C70" />
      </div>
      <div style={{ height: 52, borderRadius: 13, backgroundColor: "rgba(118,118,128,0.12)", color: GREY, fontSize: 24, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", marginBottom: 16 }}>
        <Sym name="magnifyingglass" size={24} color={GREY} />
        Search
      </div>
      {THREADS.map((t, i) => {
        const on = i === state.thread;
        const unread = !on && i < 3;
        const lastMsg = on && latest ? latest : t.messages.filter((m) => m.at <= b).at(-1);
        const preview = lastMsg ? (lastMsg.text ?? `Link: ${lastMsg.link?.host}`) : "";
        return (
          <div key={t.id} style={{ position: "relative", display: "flex", gap: 14, alignItems: "center", padding: "14px 14px 14px 30px", borderRadius: 16, backgroundColor: on ? SELECTED : "transparent", marginBottom: 4 }}>
            {unread ? <div style={{ position: "absolute", left: 8, top: "50%", translate: "0 -50%", width: 14, height: 14, borderRadius: 7, backgroundColor: SELECTED }} /> : null}
            <GroupAvatar people={t.members.filter((p) => p !== "Priya")} size={64} ring={on ? SELECTED : SIDEBAR} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 25, fontWeight: 600, color: on ? "#FFFFFF" : "#000000", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                <div style={{ fontSize: 19, color: on ? "rgba(255,255,255,0.85)" : GREY, flexShrink: 0 }}>{STAMPS[i]}</div>
              </div>
              <div style={{ fontSize: 21, color: on ? "rgba(255,255,255,0.85)" : GREY, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {preview}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatApp({ b, width, height, state, port, focus = 0, extra = [], hide = [], pointer }: { b: number; width: number; height: number; state: ChatState; port: boolean; focus?: number; extra?: Msg[]; hide?: string[]; pointer?: { x: number; y: number; press: number } | null }) {
  const list = port ? 0 : 440;
  const thread = THREADS[state.thread];
  const shown = [...thread.messages, ...extra].filter((m) => b >= m.at);
  const area = height - HEADER - COMPOSE;
  const history = thread.history ?? [];
  const { items, total } = stack(history, shown, [...thread.messages, ...extra].findIndex((m) => m.at > -0.5));
  const historyH = items.filter((it) => (it.kind === "msg" ? history.includes(it.m) : it.text[0] === "Yesterday")).reduce((sum, it) => sum + it.h, 0);
  const latest = shown[shown.length - 1];
  const latestItem = items.at(-1);
  const settle = latest && latest.at > -0.5 ? springAt(b, latest.at, { stiffness: 260, damping: 26 }) : 1;
  const before = items.at(-2);
  const arrived = latestItem && latestItem.kind === "msg" && before?.kind === "stamp" && before.text[0] === "Today" ? latestItem.h + before.h : latestItem?.h ?? 0;
  const lift = arrived * (1 - settle);
  const y0 = area - total + lift + state.scroll * historyH;
  const enter = easeOut(clamp((b - state.switchAt) / 0.35));
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 30, overflow: "hidden", backgroundColor: PAPER, fontFamily: SF, boxShadow: "0 20px 60px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.08)" }}>
      {list ? <Sidebar b={b} state={state} latest={latest} /> : null}
      <div style={{ position: "absolute", left: list, right: 0, top: 0, bottom: 0, opacity: mix(0.4, 1, enter) }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: HEADER, height: area, overflow: "hidden", WebkitMaskImage: "linear-gradient(to bottom, transparent 0, black 46px)", maskImage: "linear-gradient(to bottom, transparent 0, black 46px)" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + 0.9 * focus})`, transformOrigin: "30% 70%" }}>
            {items.map((it, k) => {
              const top = y0 + it.top;
              if (top + it.h < -60 || top > area + 60) return null;
              if (it.kind === "stamp") {
                return (
                  <div key={`s${k}`} style={{ position: "absolute", left: 0, right: 0, top: top + 14, textAlign: "center", fontSize: 21, color: GREY }}>
                    <span style={{ fontWeight: 600 }}>{it.text[0]}</span> {it.text[1]}
                  </div>
                );
              }
              const m = it.m;
              const pop = m.at > -0.5 ? springAt(b, m.at, { stiffness: 420, damping: 24 }) : 1;
              const style: CSSProperties = {
                position: "absolute", top, [m.me ? "right" : "left"]: m.me ? INSET + 10 : INSET + AVATAR + 18, display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start",
                transformOrigin: m.me ? "100% 100%" : "0 100%", scale: String(mix(0.85, 1, pop)), opacity: clamp(pop * 3),
              };
              return (
                <div key={`${k}${m.who}${m.at}`} style={style}>
                  {it.name ? <div style={{ fontSize: 21, color: GREY, height: NAME_H, margin: "0 0 0 24px" }}>{m.who}</div> : null}
                  {m.link ? <div style={{ opacity: hide.includes(m.link.host) ? 0 : 1 }}><LinkCard link={m.link} /></div> : <Bubble m={m} tail={it.tail} />}
                  {it.read ? <div style={{ fontSize: 20, color: GREY, height: READ_H, paddingTop: 6, marginRight: 8 }}>Read</div> : null}
                  {it.face ? (
                    <div style={{ position: "absolute", left: -(AVATAR + 14), bottom: RUN_GAP - 2 }}>
                      <Face who={m.who} size={AVATAR} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {state.scroll > 0.02 ? (
            <div style={{ position: "absolute", left: "50%", bottom: 22, translate: "-50% 0", padding: "12px 26px", borderRadius: 30, backgroundColor: "rgba(242,242,247,0.96)", boxShadow: "0 4px 14px rgba(0,0,0,0.14)", color: SELECTED, fontSize: 24, fontWeight: 600, opacity: clamp(state.scroll * 6) }}>
              ↓ {Math.round(12 + state.scroll * 36)} new messages
            </div>
          ) : null}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: HEADER, borderBottom: "1px solid #E5E5EA", backgroundColor: "rgba(255,255,255,0.78)", backdropFilter: "blur(24px) saturate(1.6)" }}>
          {port ? <Lights style={{ position: "absolute", left: 28, top: 26 }} /> : null}
          <div style={{ position: "absolute", left: 0, right: 0, top: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <GroupAvatar people={thread.members.filter((p) => p !== "Priya")} size={62} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 23, fontWeight: 600, color: "#000000" }}>
              {thread.title}
              <Sym name="chevron.right" size={16} color={GREY} />
            </div>
          </div>
          <div style={{ position: "absolute", right: INSET, top: 0, height: HEADER, display: "flex", alignItems: "center", gap: 30 }}>
            <Sym name="video" size={44} color="#6C6C70" />
            <Sym name="info.circle" size={44} color="#6C6C70" />
          </div>
        </div>
        <div style={{ position: "absolute", left: INSET - 8, right: INSET - 8, bottom: 26, height: 62, display: "flex", alignItems: "center", gap: 16 }}>
          <Sym name="plus.circle.fill" size={50} color="#B9B9BE" />
          <div style={{ flex: 1, height: 62, borderRadius: 31, border: "1.5px solid #D1D1D6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px 0 26px", color: "#AEAEB2", fontSize: 26 }}>
            Message
            <Sym name="face.smiling" size={34} color="#AEAEB2" />
          </div>
        </div>
      </div>
      {state.panel && state.panel > 0.001 ? <LinksPanel width={width} port={port} open={state.panel} count={state.links} hide={hide} /> : null}
      {pointer ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, scale: "1.7", transformOrigin: `${pointer.x}px ${pointer.y}px` }}>
          <Pointer x={pointer.x} y={pointer.y} press={pointer.press} />
        </div>
      ) : null}
    </div>
  );
}

export function chatState(b: number, marks: Record<string, number>): ChatState {
  const thread = b < marks.launch ? 0 : b < marks.back ? 1 : 0;
  const switchAt = b < marks.launch ? -1 : b < marks.back ? marks.launch : marks.back;
  const up = easeInOut(clamp((b - marks.scroll) / (marks.scrollEnd - marks.scroll - 0.6)));
  const down = seg(b, marks.scrollEnd - 0.5, 0.45, easeInOut);
  const scroll = thread === 0 ? up * (1 - down) : 0;
  const t = THREADS[thread];
  const links = t.links + t.messages.filter((m) => m.at > -0.5 && b >= m.at && m.link).length;
  const panel = marks.panel !== undefined && thread === 0 ? sine(clamp((b - marks.panel) / 0.7)) : 0;
  return { thread, switchAt, scroll, links, panel };
}
