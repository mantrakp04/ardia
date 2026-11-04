import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { clamp, easeInOut, easeOut, mix, seg, springAt } from "./kit";
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
  pressroom: L("pressroom.example", "Lumo Press Kit"),
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
      { at: 7.2, who: "Jun", text: "found it?" },
      { at: 7.6, who: "Ava", text: "which one lol" },
    ],
  },
  {
    id: "launch", title: "lumo launch 🚀", members: ["Maya", "Leo"], links: 23,
    messages: [
      { at: -3, who: "Leo", text: "where’s the press kit link" },
      { at: -2, who: "Maya", link: LINKS.pressroom },
      { at: -1, who: "Leo", text: "no the OTHER one" },
      { at: 8.6, who: "Maya", link: LINKS.roadmap },
      { at: 9.4, who: "Leo", text: "can u resend the mockups 🙏" },
      { at: 10.2, who: "Maya", text: "it’s in the doc", me: true },
      { at: 11.0, who: "Leo", text: "what doc 💀" },
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
const NAME = 24;
const heightOf = (m: Msg) => (m.link ? 316 : BUBBLE * 1.25 + 32) + (m.me ? 0 : NAME + 8);
const GAP = 22;

function Bubble({ m }: { m: Msg }) {
  return (
    <div style={{ padding: "16px 26px", borderRadius: 34, fontSize: BUBBLE, lineHeight: 1.25, maxWidth: 820, backgroundColor: m.me ? "#26231F" : "#FFFFFF", color: m.me ? "#FBF8F2" : "#1E1A16", border: m.me ? "none" : "1px solid #ECE4D6", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", whiteSpace: "nowrap" }}>
      {m.text}
    </div>
  );
}

export function LinkCard({ link, width = 600 }: { link: Link; width?: number }) {
  const k = width / 600;
  return (
    <div style={{ width, borderRadius: 26 * k, overflow: "hidden", backgroundColor: "#fff", border: "1px solid #ECE4D6", boxShadow: "0 2px 6px rgba(0,0,0,0.06)" }}>
      <div style={{ height: 200 * k, overflow: "hidden", backgroundColor: "#E9E2D4" }}>
        <Img src={staticFile(`footage/sf-pages/${link.host}.jpg`)} style={{ width: "100%", display: "block" }} />
      </div>
      <div style={{ padding: `${14 * k}px ${22 * k}px ${16 * k}px` }}>
        <div style={{ fontSize: 30 * k, fontWeight: 650, color: "#1E1A16", whiteSpace: "nowrap" }}>{link.title}</div>
        <div style={{ fontSize: 22 * k, color: "#2150D9", marginTop: 4 * k }}>{link.host}</div>
      </div>
    </div>
  );
}

function Avatars({ people, size }: { people: Person[]; size: number }) {
  return (
    <div style={{ display: "flex" }}>
      {people.slice(0, 3).map((n, i) => (
        <div key={n} style={{ width: size, height: size, borderRadius: size / 2, marginLeft: i ? -size * 0.3 : 0, backgroundColor: COLOR[n], border: `3px solid #FFFDF8`, color: "#fff", fontWeight: 700, fontSize: size * 0.42, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {n[0]}
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
}

export function ChatApp({ b, height, state, port, focus = 0, extra = [] }: { b: number; height: number; state: ChatState; port: boolean; focus?: number; extra?: Msg[] }) {
  const list = port ? 0 : 440;
  const thread = THREADS[state.thread];
  const shown = [...thread.messages, ...extra].filter((m) => b >= m.at);
  const area = height - 132 - 112;
  const total = shown.reduce((sum, m) => sum + heightOf(m) + GAP, 0);
  const latest = shown[shown.length - 1];
  const settle = latest && latest.at > -0.5 ? springAt(b, latest.at, { stiffness: 260, damping: 26 }) : 1;
  const lift = latest ? (heightOf(latest) + GAP) * (1 - settle) : 0;
  const history = thread.history ?? [];
  const historyH = history.reduce((sum, m) => sum + heightOf(m) + GAP, 0);
  const all = [...history, ...shown];
  let y = area - total - historyH + lift + state.scroll * historyH;
  const placed = all.map((m) => {
    const top = y;
    y += heightOf(m) + GAP;
    return { m, top };
  });
  const enter = easeOut(clamp((b - state.switchAt) / 0.35));
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 30, overflow: "hidden", backgroundColor: "#FBF8F2", fontFamily: SF, boxShadow: "0 20px 60px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)" }}>
      {list ? (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: list, backgroundColor: "#F3EEE4", borderRight: "1px solid #E5DDCF", padding: "24px 18px" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 26, marginLeft: 6 }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c }} />)}
          </div>
          <div style={{ height: 54, borderRadius: 16, backgroundColor: "#E9E2D5", color: "#958B7C", fontSize: 24, display: "flex", alignItems: "center", padding: "0 20px", marginBottom: 18 }}>Search</div>
          {THREADS.map((t, i) => {
            const on = i === state.thread;
            const unread = on ? 0 : t.links % 9 + 3;
            return (
              <div key={t.id} style={{ display: "flex", gap: 16, alignItems: "center", padding: "16px 14px", borderRadius: 20, backgroundColor: on ? "#FFFFFF" : "transparent", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.06)" : undefined, marginBottom: 6 }}>
                <Avatars people={t.members} size={50} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 25, fontWeight: 650, color: "#1E1A16", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                  <div style={{ fontSize: 19, color: "#857C6F", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(t.messages.filter((m) => m.at <= b).at(-1)?.text ?? t.messages.filter((m) => m.at <= b).at(-1)?.link?.host) ?? ""}
                  </div>
                </div>
                {unread ? <div style={{ minWidth: 34, height: 34, borderRadius: 17, backgroundColor: "#C3371F", color: "#fff", fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 9px" }}>{unread}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div style={{ position: "absolute", left: list, right: 0, top: 0, bottom: 0, opacity: mix(0.4, 1, enter) }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 132, borderBottom: "1px solid #E7E0D3", backgroundColor: "#FFFDF8", display: "flex", alignItems: "center", padding: "0 34px", gap: 20 }}>
          {port ? (
            <div style={{ display: "flex", gap: 10, position: "absolute", left: 26, top: 22 }}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c }} />)}
            </div>
          ) : null}
          <div style={{ marginLeft: port ? 70 : 0 }}>
            <Avatars people={thread.members} size={62} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "#1E1A16", whiteSpace: "nowrap" }}>{thread.title}</div>
            <div style={{ fontSize: 22, color: "#7B7368", marginTop: 4 }}>{thread.members.join(", ")}</div>
          </div>
          <div style={{ padding: "12px 22px", borderRadius: 30, backgroundColor: "#C3371F", color: "#fff", fontWeight: 700, fontSize: 28, display: "flex", gap: 10, alignItems: "center" }}>
            <Img src={staticFile("brand/sf/sym-link.png")} style={{ width: 24, height: 24, filter: "invert(1)" }} />
            {state.links}
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 132, height: area, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scale(${1 + 0.9 * focus})`, transformOrigin: "30% 70%" }}>
            {placed.filter(({ top, m }) => top + heightOf(m) > -40 && top < area + 40).map(({ m, top }, k) => {
              const pop = m.at > -0.5 ? springAt(b, m.at, { stiffness: 420, damping: 24 }) : 1;
              const style: CSSProperties = {
                position: "absolute", top, [m.me ? "right" : "left"]: 36, display: "flex", flexDirection: "column", alignItems: m.me ? "flex-end" : "flex-start",
                transformOrigin: m.me ? "100% 100%" : "0 100%", scale: String(mix(0.85, 1, pop)), opacity: clamp(pop * 3),
              };
              return (
                <div key={`${k}${m.who}${m.at}`} style={style}>
                  {!m.me ? <div style={{ fontSize: NAME, fontWeight: 650, color: COLOR[m.who], margin: "0 0 8px 20px" }}>{m.who}</div> : null}
                  {m.link ? <LinkCard link={m.link} /> : <Bubble m={m} />}
                </div>
              );
            })}
          </div>
          {state.scroll > 0.02 ? (
            <div style={{ position: "absolute", left: "50%", bottom: 22, translate: "-50% 0", padding: "12px 26px", borderRadius: 30, backgroundColor: "#26231F", color: "#fff", fontSize: 24, fontWeight: 600, opacity: clamp(state.scroll * 6) }}>
              ↓ {Math.round(12 + state.scroll * 36)} new messages
            </div>
          ) : null}
        </div>
        <div style={{ position: "absolute", left: 28, right: 28, bottom: 26, height: 64, borderRadius: 32, backgroundColor: "#fff", border: "1px solid #E2DACB", display: "flex", alignItems: "center", padding: "0 28px", color: "#A59C8E", fontSize: 26 }}>Message {thread.title}</div>
      </div>
    </div>
  );
}

export function chatState(b: number, marks: Record<string, number>): ChatState {
  const thread = b < marks.launch ? 0 : b < marks.trip ? 1 : 2;
  const switchAt = thread === 0 ? -1 : thread === 1 ? marks.launch : marks.trip;
  const up = easeInOut(clamp((b - marks.scroll) / (marks.scrollEnd - marks.scroll - 0.6)));
  const down = seg(b, marks.scrollEnd - 0.5, 0.45, easeInOut);
  const scroll = thread === 0 ? up * (1 - down) : 0;
  const t = THREADS[thread];
  const links = t.links + t.messages.filter((m) => m.at > -0.5 && b >= m.at && m.link).length;
  return { thread, switchAt, scroll, links };
}
