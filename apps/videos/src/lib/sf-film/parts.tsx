import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { clamp, easeOut, mix, seg, springAt } from "./kit";
import { PEOPLE } from "./plan";

const SF = '-apple-system, "SF Pro Text", "SF Pro", "Helvetica Neue", sans-serif';

interface Msg {
  at: number;
  who: "Jun" | "Ava" | "Tomás" | "Priya";
  text?: string;
  link?: { host: string; title: string; site: string };
}
const PEOPLE_CHAT: Record<Msg["who"], string> = { Jun: "#2F8A5F", Ava: "#C8692F", Tomás: PEOPLE.tomas.color, Priya: PEOPLE.priya.color };
export const CHAT: Msg[] = [
  { at: -4, who: "Jun", link: { host: "canopy.example", title: "Canopy & Street Heat", site: "Journal of City Climates" } },
  { at: -3, who: "Ava", text: "is this the one for the lit review" },
  { at: -2, who: "Tomás", link: { host: "citydata.example", title: "Street Tree Census", site: "Port Alder Open Data" } },
  { at: -1, who: "Ava", text: "wait which link??" },
  { at: 0.5, who: "Priya", text: "no the OTHER heat map" },
  { at: 1, who: "Jun", link: { host: "heatmap.example", title: "Summer Heat Map", site: "heatmap.example" } },
  { at: 1.5, who: "Ava", text: "can someone resend 🙏" },
  { at: 2.5, who: "Tomás", text: "pasting them all in a doc 💀" },
  { at: 3, who: "Jun", text: "which doc" },
];
const height = (m: Msg) => (m.link ? 236 : 78);
const GAP = 14;

export function ChatWindow({ b, width, height: h, zoom, push }: { b: number; width: number; height: number; zoom: number; push: number }) {
  const lw = width / zoom;
  const lh = h / zoom;
  const shown = CHAT.filter((m) => b >= m.at);
  const links = 44 + shown.filter((m) => m.link).length;
  const total = shown.reduce((sum, m) => sum + height(m) + GAP, 0);
  const latest = shown[shown.length - 1];
  const settle = latest ? springAt(b, latest.at, { stiffness: 300, damping: 26 }) : 1;
  const lift = latest ? (height(latest) + GAP) * (1 - settle) : 0;
  const area = lh - 120 - 96;
  let y = area - total + lift;
  const typing = b < 0.5 ? "Priya is typing…" : b >= 2 && b < 2.5 ? "Tomás is typing…" : "";
  const placed = shown.map((m) => {
    const top = y;
    y += height(m) + GAP;
    return { m, top };
  });
  const card = placed.find(({ m }) => m.link?.host === "heatmap.example");
  const origin = card ? `${28 + 235}px ${120 + card.top + 24 + 118}px` : "50% 50%";
  const scale = 1 + 1.6 * push;
  return (
    <div style={{ position: "absolute", inset: 0, borderRadius: 26, overflow: "hidden", backgroundColor: "#FBF8F2", boxShadow: "0 14px 40px rgba(22,19,15,0.22), 0 50px 90px rgba(22,19,15,0.22)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: lw, height: lh, transform: `scale(${zoom})`, transformOrigin: "0 0", fontFamily: SF }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: origin }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 120, borderBottom: "1px solid #E7E0D3", backgroundColor: "#FFFDF8", display: "flex", alignItems: "center", padding: "0 26px", gap: 16 }}>
            <div style={{ display: "flex", gap: 9, position: "absolute", left: 22, top: 20 }}>
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <div key={c} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c }} />
              ))}
            </div>
            <div style={{ display: "flex", marginLeft: 80, marginTop: 6 }}>
              {(["Priya", "Tomás", "Jun", "Ava"] as const).map((n, i) => (
                <div key={n} style={{ width: 46, height: 46, borderRadius: 23, marginLeft: i ? -14 : 0, backgroundColor: PEOPLE_CHAT[n], border: "3px solid #FFFDF8", color: "#fff", fontWeight: 700, fontSize: 19, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {n[0]}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, marginTop: 6, minWidth: 0 }}>
              <div style={{ fontSize: 27, fontWeight: 700, color: "#1E1A16" }}>thesis gc 🌳</div>
              <div style={{ fontSize: 17, color: "#7B7368", marginTop: 3, whiteSpace: "nowrap" }}>{typing || "Priya, Tomás, Jun, Ava"}</div>
            </div>
            <div style={{ marginTop: 6, padding: "9px 16px", borderRadius: 24, backgroundColor: "#C3371F", color: "#fff", fontWeight: 700, fontSize: 21, display: "flex", gap: 8, alignItems: "center", scale: String(1 + 0.18 * Math.max(0, 1 - Math.abs(b - 1) * 4)) }}>
              <Img src={staticFile("brand/sf/sym-link.png")} style={{ width: 18, height: 18, filter: "invert(1)" }} />
              {links}
            </div>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 120, height: area, overflow: "hidden" }}>
            {placed.map(({ m, top }) => {
              const pop = springAt(b, m.at, { stiffness: 420, damping: 22 });
              const me = m.who === "Priya";
              const style: CSSProperties = { position: "absolute", top, [me ? "right" : "left"]: 28, display: "flex", flexDirection: "column", alignItems: me ? "flex-end" : "flex-start", transformOrigin: me ? "100% 100%" : "0 100%", scale: String(m.at > -0.5 ? mix(0.82, 1, pop) : 1), opacity: m.at > -0.5 ? clamp(pop * 3) : 1 };
              return (
                <div key={`${m.who}${m.at}`} style={style}>
                  {!me ? <div style={{ fontSize: 17, fontWeight: 650, color: PEOPLE_CHAT[m.who], margin: "0 0 5px 16px" }}>{m.who}</div> : null}
                  {m.link ? <LinkCard link={m.link} /> : <Bubble me={me} text={m.text ?? ""} />}
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", left: 24, right: 24, bottom: 22, height: 56, borderRadius: 28, backgroundColor: "#fff", border: "1px solid #E2DACB", display: "flex", alignItems: "center", padding: "0 24px", color: "#A59C8E", fontSize: 21 }}>Message thesis gc</div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ me, text }: { me: boolean; text: string }) {
  return (
    <div style={{ padding: "14px 22px", borderRadius: 26, fontSize: 26, lineHeight: 1.25, maxWidth: 620, backgroundColor: me ? "#2A2521" : "#FFFFFF", color: me ? "#FBF8F2" : "#1E1A16", border: me ? "none" : "1px solid #ECE4D6", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
      {text}
    </div>
  );
}

function LinkCard({ link }: { link: NonNullable<Msg["link"]> }) {
  return (
    <div style={{ width: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#fff", border: "1px solid #ECE4D6", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
      <div style={{ height: 128, overflow: "hidden", backgroundColor: "#E9E2D4" }}>
        <Img src={staticFile(`footage/sf-pages/${link.host}.jpg`)} style={{ width: "100%", display: "block" }} />
      </div>
      <div style={{ padding: "12px 18px 14px" }}>
        <div style={{ fontSize: 22, fontWeight: 650, color: "#1E1A16" }}>{link.title}</div>
        <div style={{ fontSize: 17, color: "#2150D9", marginTop: 3 }}>{link.host}</div>
      </div>
    </div>
  );
}

export interface MenuEntry {
  id?: string;
  title?: string;
  symbol?: string;
  separator?: boolean;
  enabled?: boolean;
  children?: unknown[] | null;
  key?: string;
  modifiers?: string[];
}
const MODS: Record<string, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const shortcut = (it: MenuEntry) => (it.key ? `${["control", "option", "shift", "command"].filter((m) => it.modifiers?.includes(m)).map((m) => MODS[m]).join("")}${it.key.toUpperCase()}` : "");
const MENU_ROW = 24;
const MENU_SEP = 11;
export function menuRowTop(items: MenuEntry[], id: string) {
  let y = 5;
  for (const it of items) {
    if (it.id === id) return y + MENU_ROW / 2;
    y += it.separator ? MENU_SEP : MENU_ROW;
  }
  return y;
}
export function MacMenu({ items, x, y, b, open, close, hover, flash }: { items: MenuEntry[]; x: number; y: number; b: number; open: number; close: number; hover: string | null; flash?: number }) {
  if (b < open || b >= close) return null;
  const t = seg(b, open, 0.15, easeOut);
  const blink = flash !== undefined && b >= flash ? Math.floor((b - flash) / 0.06) % 2 === 0 : false;
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, width: 246, padding: "5px 5px", borderRadius: 12, opacity: t,
        backgroundColor: "rgba(244,242,240,0.94)", border: "0.5px solid rgba(0,0,0,0.14)", fontFamily: SF,
        boxShadow: "0 0 0 0.5px rgba(255,255,255,0.6) inset, 0 10px 30px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
      }}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={`s${i}`} style={{ height: 1, backgroundColor: "rgba(0,0,0,0.10)", margin: "5px 10px" }} />;
        const lit = hover === it.id && !blink;
        const dim = it.enabled === false;
        return (
          <div key={`${it.id}${i}`} style={{ height: MENU_ROW, borderRadius: 7, display: "flex", alignItems: "center", padding: "0 9px", gap: 7, backgroundColor: lit ? "#2B7BF3" : "transparent", color: lit ? "#FFFFFF" : dim ? "rgba(0,0,0,0.32)" : "rgba(0,0,0,0.86)", fontSize: 13 }}>
            <div style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {it.symbol ? <Img src={staticFile(`brand/sf/sym-${it.symbol}.png`)} style={{ maxWidth: 15, maxHeight: 14, opacity: dim ? 0.35 : 0.85, filter: lit ? "invert(1)" : undefined }} /> : null}
            </div>
            <span style={{ flex: 1 }}>{it.title}</span>
            {shortcut(it) ? <span style={{ fontSize: 13, opacity: lit ? 0.85 : 0.45, letterSpacing: "0.04em" }}>{shortcut(it)}</span> : null}
            {it.children ? <span style={{ fontSize: 15, opacity: 0.55, marginTop: -2 }}>›</span> : null}
          </div>
        );
      })}
    </div>
  );
}

const SHEET_W = 312;
export function SharePicker({ x, y, b, open, close, pick, tick }: { x: number; y: number; b: number; open: number; close: number; pick: number; tick: number }) {
  if (b < open || b >= close + 0.3) return null;
  const s = springAt(b, open, { stiffness: 380, damping: 26 });
  const out = seg(b, close, 0.3, easeOut);
  const chosen = b >= pick;
  const avatar = (n: string, c: string, i: number) => (
    <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 64, gap: 5 }}>
      <div style={{ position: "relative", width: 48, height: 48, borderRadius: 24, background: `linear-gradient(160deg, ${c}, ${c}CC)`, color: "#fff", fontSize: 19, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: chosen && i === 0 ? "0 0 0 3px #2B7BF3" : undefined }}>
        {n.slice(0, 1)}
        <Img src={staticFile("brand/sf/app-messages.png")} style={{ position: "absolute", right: -4, bottom: -4, width: 22, height: 22 }} />
      </div>
      <span style={{ fontSize: 11, color: "rgba(0,0,0,0.8)" }}>{n}</span>
    </div>
  );
  const app = (key: string, label: string) => (
    <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 64, gap: 4 }}>
      <Img src={staticFile(`brand/sf/app-${key}.png`)} style={{ width: 46, height: 46 }} />
      <span style={{ fontSize: 11, color: "rgba(0,0,0,0.8)" }}>{label}</span>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: x, top: y, width: SHEET_W, transformOrigin: "0 30px", scale: String(mix(0.86, 1, s) * (1 - 0.05 * out)), opacity: clamp(s * 2) * (1 - out), fontFamily: SF }}>
      <svg width="16" height="28" style={{ position: "absolute", left: -15, top: 16 }}>
        <path d="M16 0 L2 14 L16 28 Z" fill="rgba(246,244,242,0.97)" />
      </svg>
      <div style={{ borderRadius: 14, backgroundColor: "rgba(246,244,242,0.97)", border: "0.5px solid rgba(0,0,0,0.14)", boxShadow: "0 12px 36px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.10)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Img src={staticFile("brand/sf/folder-plain.png")} style={{ width: 42, height: 42 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(0,0,0,0.88)" }}>Thesis Reading</div>
            <div style={{ fontSize: 11, color: "rgba(0,0,0,0.5)" }}>Folder · iCloud Drive</div>
          </div>
        </div>
        <div style={{ marginTop: 12, borderRadius: 9, backgroundColor: "rgba(0,0,0,0.045)", padding: "9px 10px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 6, backgroundColor: b >= tick && b < tick + 0.35 ? "rgba(43,123,243,0.18)" : "#fff", boxShadow: "0 0.5px 1.5px rgba(0,0,0,0.25)", fontSize: 13, color: "rgba(0,0,0,0.88)" }}>
            Collaborate
            <Img src={staticFile("brand/sf/sym-chevron.up.chevron.down.png")} style={{ width: 7, height: 9, opacity: 0.6 }} />
          </div>
          <div style={{ fontSize: 11, color: "rgba(0,0,0,0.55)", marginTop: 6 }}>Only invited people can make changes.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
          {avatar("Tomás", PEOPLE.tomas.color, 0)}
          {avatar("Jun", "#2F8A5F", 1)}
          {avatar("Ava", "#C8692F", 2)}
          {avatar("Study Group", "#7A6FB0", 3)}
        </div>
        <div style={{ height: 1, backgroundColor: "rgba(0,0,0,0.08)", margin: "12px -2px" }} />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {app("airdrop", "AirDrop")}
          {app("messages", "Messages")}
          {app("mail", "Mail")}
          {app("notes", "Notes")}
        </div>
        <div style={{ height: 1, backgroundColor: "rgba(0,0,0,0.08)", margin: "12px -2px 8px" }} />
        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.85)", padding: "2px 4px" }}>Copy Link</div>
      </div>
    </div>
  );
}
export const SHEET_PICK = { x: 14 + 32, y: 14 + 42 + 12 + 70 + 14 + 24 };

export function Halo({ rect, b, at, color, pad = 4 }: { rect: { x: number; y: number; width: number; height: number } | null | undefined; b: number; at: number; color: string; pad?: number }) {
  if (!rect || b < at || b > at + 2.2) return null;
  const t = clamp((b - at) / 2.2);
  const grow = easeOut(clamp((b - at) / 0.5));
  const fade = 1 - seg(b, at + 1.2, 1);
  return (
    <div
      style={{
        position: "absolute", left: rect.x - pad - 3 * grow, top: rect.y - pad - 3 * grow, width: rect.width + 2 * pad + 6 * grow, height: rect.height + 2 * pad + 6 * grow,
        borderRadius: 12, border: `2.5px solid ${color}`, opacity: fade * clamp((b - at - 0.3) / 0.25) * (t < 1 ? 1 : 0), boxShadow: `0 0 ${16 * grow}px ${color}88`,
      }}
    />
  );
}

export function MacBanner({ x, y, b, at, out, title, body }: { x: number; y: number; b: number; at: number; out: number; title: string; body: string }) {
  if (b < at || b > out + 0.3) return null;
  const s = springAt(b, at, { stiffness: 300, damping: 26 });
  const gone = seg(b, out, 0.3, easeOut);
  return (
    <div style={{ position: "absolute", left: x + (1 - s) * 380, top: y, width: 344, opacity: 1 - gone, scale: String(1 - 0.04 * gone), fontFamily: SF }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 13px", borderRadius: 18, backgroundColor: "rgba(246,245,243,0.96)", border: "0.5px solid rgba(0,0,0,0.12)", boxShadow: "0 10px 30px rgba(0,0,0,0.20), 0 1px 3px rgba(0,0,0,0.10)" }}>
        <Img src={staticFile("brand/sf/app-messages.png")} style={{ width: 38, height: 38 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(0,0,0,0.88)" }}>{title}</span>
            <span style={{ fontSize: 11, color: "rgba(0,0,0,0.42)" }}>now</span>
          </div>
          <div style={{ fontSize: 13, color: "rgba(0,0,0,0.78)", marginTop: 1, lineHeight: 1.25 }}>{body}</div>
        </div>
      </div>
    </div>
  );
}
