import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Img, staticFile, useVideoConfig } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import { ChatApp, chatState, LINKS, LinkCard, THREADS } from "./chat";
import {
  byTime, camAt, clamp, easeInOut, easeOut, indexOf, kick, lastIndexOf, mix, Paper, Pointer, pointerPath, scene, Screen, seg,
  Supers, useAspect, useBeat, useShot, type Frame,
} from "./kit";
import { Morph, planMorph, type Rect, type Rows, targetAt } from "./morph";
import { Halo, MacMenu, type MenuEntry, menuRowTop, SharePicker, SHEET_PICK } from "./parts";
import { DARK_BG, LIGHT_BG, type Pane, PEOPLE, type ShotKind, type View, WIN_PT } from "./plan";

const SLOW = 5;
const BEAT_MS = 600;

function useCam(pane: Pane | undefined) {
  const aspect = useAspect();
  const b = useBeat();
  return camAt(pane?.cam?.[aspect] ?? [{ at: 0 }], b);
}

function Box({ id, children, style }: { id: string; children?: ReactNode; style?: CSSProperties }) {
  const object = useStudioObject(id);
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" });
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, ...style }}>
      {children}
    </div>
  );
}

const fr = (name: string, i: number): Frame => scene(name).frames[Math.max(0, Math.min(scene(name).frames.length - 1, i))];
const has = (name: string, label: string) => scene(name).frames.some((f) => f.label === label);
const tintOf = (name: string) => ((scene(name) as unknown as { tint?: [string, string] }).tint ?? ["#E4C8CE", "#EDDEE1"]) as [string, string];
const linkRow = (name: string, match: RegExp, label = "after") => {
  const s = scene(name) as unknown as { links?: [string, string, string][]; frames: Frame[] };
  const id = s.links?.find(([, , u]) => match.test(u))?.[0];
  const rows = s.frames[lastIndexOf(name, label)].rows ?? {};
  return id ? rows[id] ?? null : null;
};

interface Arrival {
  index: number;
  overlay: ReactNode;
  halo: Rect | null;
}
function playback(name: string, b: number, at: number, labels: string[], start: number): Arrival {
  const fs = scene(name).frames;
  if (b < at) return { index: start, overlay: null, halo: null };
  const first = fs.findIndex((f) => labels.includes(f.label) && (f.has === undefined || f.has === 1));
  const t0 = first >= 0 ? fs[first].seen ?? fs[first].t : fs[start].t;
  const ms = (b - at) * BEAT_MS + 40;
  const last = Math.max(...labels.map((l) => (has(name, l) ? lastIndexOf(name, l) : -1)));
  return { index: ms > 1800 ? last : byTime(name, labels, t0, SLOW, ms), overlay: null, halo: null };
}
function arrival(name: string, b: number, at: number, opts: { before?: string; after?: string; rename?: RegExp; top?: boolean } = {}): Arrival {
  const beforeLabel = opts.before ?? "arrive:before";
  if (opts.top) return playback(name, b, at, opts.after === "added" ? ["adding", "added"] : ["arrive", "settled"], indexOf(name, beforeLabel));
  const afterLabel = opts.after ?? (has(name, "settled") ? "settled" : "arrive");
  const rowsLabel = opts.after ?? (has(name, "settled") ? "settled" : "after");
  const before = indexOf(name, beforeLabel);
  const after = lastIndexOf(name, afterLabel);
  const rowsA = fr(name, lastIndexOf(name, rowsLabel)).rows ?? {};
  const rowsB: Rows = fr(name, indexOf(name, "rest")).rows ?? {};
  const plan = opts.rename ? null : planMorph(rowsB, rowsA);
  if (!plan) {
    const halo = opts.rename ? linkRow(name, opts.rename, rowsLabel) : null;
    return { index: b < at ? before : after, overlay: null, halo: b >= at ? halo : null };
  }
  const dur = plan.from ? 0.8 : 0.6;
  const t = plan.from ? easeInOut(clamp((b - at) / dur)) : easeOut(clamp((b - at) / dur));
  if (b < at) return { index: before, overlay: null, halo: null };
  const overlay = t < 1 ? <Morph src={name} before={before} after={after} plan={plan} p={t} tint={tintOf(name)} /> : null;
  return { index: after, overlay, halo: targetAt(plan, t) };
}

function dragIndex(name: string, b: number, grab: number, up: number) {
  const fs = scene(name).frames;
  const down = indexOf(name, "drag:down");
  const ups = indexOf(name, "drag:up");
  if (b < grab) return indexOf(name, "rest");
  if (b < up) return down + Math.min(ups - down - 1, Math.round(((b - grab) / (up - grab)) * (ups - down - 1)));
  const t0 = fs[ups].up ?? fs[ups].t;
  const ms = (b - up) * BEAT_MS;
  return ms > 1200 ? lastIndexOf(name, "after") : byTime(name, ["drag:up", "settle"], t0, SLOW, ms);
}
function dragPointer(name: string, i: number, b: number, up: number, grab: number) {
  const f = fr(name, i);
  if (f.ptr && b >= grab) return { x: f.ptr[0], y: f.ptr[1], press: f.press ?? 0 };
  const g = fr(name, indexOf(name, "drag:grab")).ptr;
  const lastUp = fr(name, indexOf(name, "drag:up")).ptr;
  if (b >= up && lastUp) return { x: lastUp[0] + 14 * seg(b, up + 0.7, 1.2), y: lastUp[1] + 20 * seg(b, up + 0.7, 1.2), press: 0 };
  if (!g) return null;
  const t = easeOut(clamp((b - (grab - 1)) / 1));
  return { x: mix(g[0] + 70, g[0], t), y: mix(g[1] + 100, g[1], t), press: 0 };
}

function PaneView({ pane }: { pane: Pane }) {
  const b = useBeat();
  const cam = useCam(pane);
  const who = pane.who ? PEOPLE[pane.who] : null;
  const name = pane.scene!;
  const m = pane.marks ?? {};
  const top = pane.layout === "top";
  let index = 0;
  let overlay: ReactNode = null;
  let halo: Rect | null = null;
  let haloAt = 0;
  let pointer: { x: number; y: number; press: number } | null = null;
  let kicked = 0;
  if (pane.role === "drag") {
    index = dragIndex(name, b, m.grab, m.up);
    pointer = dragPointer(name, index, b, m.up, m.grab);
  } else if (pane.role === "add") {
    const arr = arrival(name, b, m.arrive, { before: "rest", after: "added", top });
    ({ index, overlay, halo } = arr);
    haloAt = m.arrive;
    kicked = m.arrive;
  } else if (pane.role === "arrive") {
    const arr = arrival(name, b, m.arrive, { top });
    ({ index, overlay, halo } = arr);
    haloAt = m.arrive;
    kicked = m.arrive;
  } else {
    index = has(name, "shared") ? lastIndexOf(name, "shared") : indexOf(name, "rest");
  }
  const k = kicked ? kick(b, kicked, 0.25) : 0;
  return (
    <div style={{ position: "absolute", inset: 0, scale: String(1 + 0.008 * k) }}>
      <Screen id={pane.id} src={name} index={index} view={cam} tag={who?.name} tagColor={who?.color}>
        {overlay}
        {who ? <Halo rect={halo} b={b} at={haloAt} color={who.color} /> : null}
        {pointer ? <Pointer x={pointer.x} y={pointer.y} press={pointer.press} /> : null}
      </Screen>
    </div>
  );
}

function EditsPane({ pane }: { pane: Pane }) {
  const b = useBeat();
  const cam = useCam(pane);
  const who = PEOPLE[pane.who!];
  const m = pane.marks!;
  let src = "";
  let index = 0;
  let overlay: ReactNode = null;
  let halo: Rect | null = null;
  let haloAt = 0;
  let pointer: { x: number; y: number; press: number } | null = null;
  if (pane.who === "priya") {
    if (b < m.reorderArrive) {
      src = "sf-rename";
      const fs = scene(src).frames;
      const first = indexOf(src, "type");
      const n = fs.filter((f) => f.label === "type").length;
      if (b < m.renameType - 0.5) index = indexOf(src, "rest");
      else if (b < m.renameType) index = indexOf(src, "field");
      else if (b < m.renameCommit) index = first + Math.min(n - 1, Math.floor(((b - m.renameType) / (m.renameCommit - m.renameType - 0.1)) * n));
      else index = byTime(src, ["commit", "settle", "after"], fs[indexOf(src, "commit")].t, SLOW, (b - m.renameCommit) * BEAT_MS);
    } else if (b < m.nest) {
      src = "sf-watch-reorder";
      ({ index, overlay, halo } = arrival(src, b, m.reorderArrive));
      haloAt = m.reorderArrive;
    } else {
      src = "sf-sub";
      const fs = scene(src).frames;
      const rowsB = fr(src, indexOf(src, "rest")).rows ?? {};
      const rowsA = fr(src, lastIndexOf(src, "after")).rows ?? {};
      const plan = planMorph(rowsB, rowsA);
      const t = easeOut(clamp((b - m.nest) / 0.6));
      index = lastIndexOf(src, "after");
      if (plan && t < 1) overlay = <Morph src={src} before={indexOf(src, "rest")} after={index} plan={plan} p={t} tint={tintOf(src)} />;
      halo = plan ? targetAt(plan, t) : null;
      haloAt = m.nest;
      void fs;
    }
  } else {
    if (b < m.reorderGrab) {
      src = "sf-watch-rename";
      ({ index, overlay, halo } = arrival(src, b, m.renameArrive, { rename: /heatmap/ }));
      haloAt = m.renameArrive;
    } else if (b < m.nestArrive) {
      src = "sf-reorder";
      index = dragIndex(src, b, m.reorderGrab, m.reorderUp);
      pointer = dragPointer(src, index, b, m.reorderUp, m.reorderGrab);
    } else {
      src = "sf-watch-sub";
      ({ index, overlay, halo } = arrival(src, b, m.nestArrive));
      haloAt = m.nestArrive;
    }
  }
  return (
    <Screen id={pane.id} src={src} index={index} view={cam} tag={who.name} tagColor={who.color}>
      {overlay}
      <Halo rect={halo} b={b} at={haloAt} color={who.color} />
      {pointer ? <Pointer x={pointer.x} y={pointer.y} press={pointer.press} /> : null}
    </Screen>
  );
}

function PanesShot() {
  const shot = useShot();
  return (
    <Paper tone={shot.tone === "dark" ? DARK_BG : LIGHT_BG}>
      {shot.panes!.map((p) => (p.role === "edits" ? <EditsPane key={p.id} pane={p} /> : <PaneView key={p.id} pane={p} />))}
      <Supers />
    </Paper>
  );
}

function ChatShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const box = shot.panes![0];
  const object = useStudioObject(box.id);
  const push = 1 + 0.03 * seg(b, 0, 16, (x) => x);
  return (
    <Paper>
      <Box id={box.id} style={{ scale: String(push) }}>
        <ChatApp b={b} height={object.number("height")} state={chatState(b, shot.marks!)} port={aspect === "port"} />
      </Box>
      <Supers />
    </Paper>
  );
}

function toFrame(box: { x: number; y: number; w: number; h: number }, v: View, pt: { x: number; y: number }) {
  const hw = box.w / 2 / v.s;
  const hh = box.h / 2 / v.s;
  const cx = hw * 2 >= WIN_PT[0] ? WIN_PT[0] / 2 : clamp(v.cx, hw, WIN_PT[0] - hw);
  const cy = hh * 2 >= WIN_PT[1] ? WIN_PT[1] / 2 : clamp(v.cy, hh, WIN_PT[1] - hh);
  return { x: box.x + box.w / 2 + (pt.x - cx) * v.s, y: box.y + box.h / 2 + (pt.y - cy) * v.s };
}

const TURN_LINKS = [LINKS.canopy, LINKS.citydata, LINKS.course, LINKS.library, LINKS.heatmap];
function TurnShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const { width, height } = useVideoConfig();
  const pane = shot.panes![0];
  const cam = useCam(pane);
  const object = useStudioObject(pane.id);
  const box = { x: object.number("x"), y: object.number("y"), w: object.number("width"), h: object.number("height") };
  const name = pane.scene!;
  const { lift, land, stagger } = shot.marks!;
  const shared = lastIndexOf(name, "shared");
  const rows = Object.entries(fr(name, shared).rows ?? {}).filter((e): e is [string, Rect] => !!e[1] && e[1].x < 250).sort((a, b2) => a[1].y - b2[1].y);
  const [header, ...links] = rows;
  const tint = tintOf(name);
  const fade = 1 - easeInOut(clamp((b - 0.2) / 1.6));
  const rise = easeOut(clamp((b - 0.6) / 1.4));
  const chatScale = mix(0.9, 1, fade);
  const landed = (i: number) => clamp((b - (lift + land + i * stagger)) / 0.35);
  return (
    <Paper>
      {fade > 0.01 ? (
        <div style={{ position: "absolute", inset: 0, opacity: fade, scale: String(chatScale) }}>
          <Box id="chat-app">
            <ChatApp b={16} height={aspect === "land" ? 870 : 1240} state={{ thread: 2, switchAt: -1, scroll: 0, links: THREADS[2].links + 1 }} port={aspect === "port"} />
          </Box>
        </div>
      ) : null}
      <div style={{ position: "absolute", inset: 0, opacity: rise, translate: `0 ${(1 - rise) * 40}px` }}>
        <Screen id={pane.id} src={name} index={shared} view={cam} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
          {links.map(([id, r], i) => (
            <div key={id} style={{ position: "absolute", left: 0, top: r.y - 1.5, width: 250, height: r.height + 3, opacity: 1 - landed(i), backgroundImage: `linear-gradient(to bottom, ${tint[0]}, ${tint[1]})`, backgroundSize: `250px ${WIN_PT[1]}px`, backgroundPosition: `0 ${-(r.y - 1.5)}px` }} />
          ))}
          {header ? <Halo rect={header[1]} b={b} at={lift + land + links.length * stagger} color={PEOPLE.priya.color} /> : null}
        </Screen>
      </div>
      {links.map(([id, r], i) => {
        const start = lift + i * stagger;
        const t = easeInOut(clamp((b - start) / land));
        if (b < start - 0.05 || landed(i) >= 1) return null;
        const target = toFrame(box, cam, { x: r.x + 4, y: r.y });
        const from = { x: (aspect === "land" ? 300 : 120) + (i % 2) * (aspect === "land" ? 520 : 300), y: (aspect === "land" ? 220 : 520) + i * (aspect === "land" ? 120 : 160) };
        const targetW = (r.width - 8) * cam.s;
        const w = mix(aspect === "land" ? 560 : 520, targetW, t);
        const x = mix(from.x, target.x, t);
        const y = mix(from.y, target.y, t) - Math.sin(Math.PI * t) * 80;
        return (
          <div key={id} style={{ position: "absolute", left: x, top: y, width: w, opacity: 1 - landed(i), filter: `drop-shadow(0 ${16 * (1 - t)}px ${28 * (1 - t)}px rgba(0,0,0,0.18))`, transformOrigin: "0 0" }}>
            <div style={{ position: "relative", width: w, height: mix(316 * (w / 600), r.height * cam.s, t), overflow: "hidden", borderRadius: mix(26, 8, t) }}>
              <div style={{ opacity: 1 - seg(b, start + land * 0.55, land * 0.4) }}>
                <LinkCard link={TURN_LINKS[i] ?? LINKS.canopy} width={w} />
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display: "none" }}>{width + height}</div>
      <Supers />
    </Paper>
  );
}

function ShareShot() {
  const shot = useShot();
  const b = useBeat();
  const pane = shot.panes![0];
  const cam = useCam(pane);
  const name = pane.scene!;
  const m = shot.marks!;
  const head = fr(name, indexOf(name, "rest")).head!;
  const menu = (scene(name).menu ?? []) as MenuEntry[];
  const hx = head.x + 96;
  const hy = head.y + head.height / 2;
  const target = menuRowTop(menu, "shareFolder");
  const sx = head.x + head.width + 18;
  const sy = head.y - 18;
  const pickX = sx + SHEET_PICK.x;
  const pickY = sy + SHEET_PICK.y;
  const p = pointerPath(b, [
    { at: m.menu - 0.2, x: hx, y: hy },
    { at: m.menu, x: hx, y: hy, click: true },
    { at: m.pick - 0.2, x: hx + 124, y: hy + 2 + target },
    { at: m.pick, x: hx + 124, y: hy + 2 + target, click: true },
    { at: m.tick, x: sx + 60, y: sy + 80, click: true },
    { at: m.choose, x: pickX, y: pickY, click: true },
    { at: m.glyph + 1, x: pickX + 90, y: pickY + 160 },
  ], 0.8);
  const index = b < m.menu - 0.3 ? indexOf(name, "rest") : b < m.glyph - 0.6 ? indexOf(name, "hover") : lastIndexOf(name, "shared");
  const glyph = fr(name, lastIndexOf(name, "shared")).head ?? head;
  return (
    <Paper>
      <Screen id={pane.id} src={name} index={index} view={cam} radius={24} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
        <MacMenu items={menu} x={hx + 4} y={hy + 2} b={b} open={m.menu + 0.05} close={m.pick + 0.25} hover={b >= m.pick - 0.5 ? "shareFolder" : null} flash={m.pick} />
        <SharePicker x={sx} y={sy} b={b} open={m.sheet} close={m.choose + 0.3} pick={m.choose} tick={m.tick} />
        <Halo rect={{ x: glyph.x + 2, y: glyph.y + 1, width: glyph.width - 4, height: glyph.height - 2 }} b={b} at={m.glyph} color={PEOPLE.priya.color} />
        {p && b < m.glyph + 0.8 ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
      <Supers />
    </Paper>
  );
}

function FilesShot() {
  const shot = useShot();
  const b = useBeat();
  const listing = (scene("sf-sub") as unknown as { files?: string[] }).files ?? [];
  const files = listing.slice(1, listing.indexOf("") < 0 ? undefined : listing.indexOf(""));
  const show = easeOut(clamp(b / 0.8));
  return (
    <Paper>
      <Box id={shot.panes![0].id} style={{ opacity: show, translate: `0 ${(1 - show) * 30}px`, scale: String(1 + 0.02 * seg(b, 0, 6, (x) => x)) }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 28, backgroundColor: "#FFFFFF", boxShadow: "0 20px 60px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)", padding: 36, fontFamily: '-apple-system, "SF Pro Text", sans-serif' }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Img src={staticFile("brand/sf/folder-plain.png")} style={{ width: 96, height: 96 }} />
            <div>
              <div style={{ fontSize: 40, fontWeight: 700, color: "#1D1D1F" }}>Thesis Reading</div>
              <div style={{ fontSize: 24, color: "#6E6E73", marginTop: 4 }}>iCloud Drive › Ardia Shared · Shared with 3 people</div>
            </div>
          </div>
          <div style={{ marginTop: 26 }}>
            {files.map((n, i) => {
              const dir = !n.endsWith(".webloc");
              const t = seg(b, 0.6 + i * 0.18, 0.5);
              return (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 16, height: 66, borderTop: i ? "1px solid #F0EEEA" : "none", fontSize: 29, color: "#1D1D1F", opacity: t, translate: `${(1 - t) * 24}px 0` }}>
                  <Img src={staticFile(dir ? "brand/sf/folder-plain.png" : "brand/sf/sym-link.png")} style={{ width: dir ? 34 : 24, height: dir ? 34 : 24, opacity: dir ? 1 : 0.45 }} />
                  {n}
                </div>
              );
            })}
          </div>
        </div>
      </Box>
      <Supers />
    </Paper>
  );
}

function CallbackShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const object = useStudioObject(shot.panes![0].id);
  return (
    <Paper>
      <Box id={shot.panes![0].id}>
        <ChatApp
          b={b + 16}
          height={object.number("height")}
          state={{ thread: 0, switchAt: 15.6, scroll: 0, links: 48 }}
          port={aspect === "port"}
          extra={[
            { at: 16.5, who: "Priya", text: "it’s all in the folder 📁", me: true },
            { at: 17.5, who: "Ava", text: "ok that’s so much better" },
            { at: 18.3, who: "Jun", text: "🙏" },
          ]}
        />
      </Box>
      <Supers />
    </Paper>
  );
}

function EndShot() {
  const shot = useShot();
  const b = useBeat();
  const s = easeOut(clamp(b / 0.6));
  const bob = Math.sin(b * 1.1) * 4;
  const push = 1 + 0.025 * seg(b, 0, 8, (x) => x);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, scale: String(push) }}>
        <Box id={shot.panes![0].id} style={{ scale: String(mix(0.85, 1, s)), opacity: s, translate: `0 ${bob}px` }}>
          <Img src={staticFile("brand/app-icon.png")} style={{ width: "100%", height: "100%", filter: "drop-shadow(0 14px 24px rgba(0,0,0,0.18))" }} />
        </Box>
        <Supers />
      </div>
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  chat: ChatShot,
  turn: TurnShot,
  panes: PanesShot,
  share: ShareShot,
  files: FilesShot,
  callback: CallbackShot,
  end: EndShot,
};
