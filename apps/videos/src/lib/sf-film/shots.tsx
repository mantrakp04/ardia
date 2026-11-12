import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import { badgeCenter, CARD_H, ChatApp, chatState, LINKS, LinkCard, panelLayout, THREADS } from "./chat";
import {
  byTime, camAt, clamp, easeInOut, easeOut, footageSrc, indexOf, lastIndexOf, mix, Paper, Pointer, pointerPath, scene, Screen, seg,
  Supers, useAspect, useBeat, useShot, type Frame,
} from "./kit";
import { Morph, planMorph, type Rect, type Rows, targetAt } from "./morph";
import { Halo, MacMenu, type MenuEntry, menuRowTop, SharePicker, SHEET_PICK } from "./parts";
import { chat, DARK_BG, LIGHT_BG, type Pane, PEOPLE, type ShotKind, type View, WIN_PT } from "./plan";

const SLOW = 5;
const sineInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
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
const STRIP_PT = 48;
function arrival(name: string, b: number, at: number, opts: { before?: string; after?: string; rename?: RegExp; top?: boolean } = {}): Arrival {
  const beforeLabel = opts.before ?? "arrive:before";
  if (opts.top) {
    const strip = (scene(name) as unknown as { strip?: Rect & { insert?: number; fill?: string } }).strip;
    const before = indexOf(name, beforeLabel);
    const last = opts.after === "added" ? lastIndexOf(name, "added") : has(name, "settled") ? lastIndexOf(name, "settled") : lastIndexOf(name, "arrive");
    if (!strip) return playback(name, b, at, opts.after === "added" ? ["adding", "added"] : ["arrive", "settled"], before);
    if (b < at) return { index: before, overlay: null, halo: null };
    const insert = strip.insert ?? strip.width;
    const t = sineInOut(clamp((b - at) / (0.72 * clamp(insert / 250, 1, 2.2))));
    const reveal = clamp((t - 0.3) / 0.6);
    const gap = t * insert;
    const right = strip.x + strip.width;
    const band = { position: "absolute", top: 0, height: STRIP_PT, overflow: "hidden" } as const;
    const frame = { position: "absolute", top: 0, width: WIN_PT[0], height: WIN_PT[1] } as const;
    const overlay = t < 1 ? (
      <>
        <div style={{ ...band, left: strip.x, width: right - strip.x }}>
          <Img src={footageSrc(name, before)} style={{ ...frame, left: -strip.x + gap }} />
        </div>
        <div style={{ ...band, left: strip.x, width: gap }}>
          <Img src={footageSrc(name, last)} style={{ ...frame, left: -strip.x }} />
          {strip.fill ? <div style={{ position: "absolute", left: 0, right: 0, top: 7, height: 28, backgroundColor: strip.fill, opacity: 1 - reveal }} /> : null}
        </div>
      </>
    ) : null;
    const halo = t > 0.8 ? { x: strip.x + 2, y: 6, width: insert - 4, height: 32 } : null;
    return { index: t < 1 ? before : last, overlay, halo };
  }
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
  const dur = plan.from ? 0.85 : 0.72;
  const t = sineInOut(clamp((b - at) / dur));
  if (b < at) return { index: before, overlay: null, halo: null };
  const tail = clamp(((b - at) / dur - 1) / 0.35);
  const overlay = tail < 1 ? <div style={{ position: "absolute", inset: 0, opacity: 1 - tail }}><Morph src={name} before={before} after={after} plan={plan} p={t} tint={tintOf(name)} /></div> : null;
  return { index: after, overlay, halo: t > 0.45 ? targetAt(plan, t) : null };
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
  if (b >= up && lastUp) return { x: lastUp[0] + 70 * seg(b, up + 0.8, 1.6, easeInOut), y: lastUp[1] + 110 * seg(b, up + 0.8, 1.6, easeInOut), press: 0 };
  if (!g) return null;
  const t = easeInOut(clamp((b - (grab - 1.2)) / 1.1));
  if (b < grab - 1.2) return null;
  return { x: mix(g[0] + 90, g[0], t), y: mix(g[1] + 140, g[1], t), press: 0 };
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
  if (pane.role === "drag") {
    index = dragIndex(name, b, m.grab, m.up);
    pointer = dragPointer(name, index, b, m.up, m.grab);
  } else if (pane.role === "add") {
    const arr = arrival(name, b, m.arrive, { before: "rest", after: "added", top });
    ({ index, overlay, halo } = arr);
    haloAt = m.arrive;
  } else if (pane.role === "arrive") {
    const arr = arrival(name, b, m.arrive, { top });
    ({ index, overlay, halo } = arr);
    haloAt = m.arrive;
  } else {
    index = has(name, "shared") ? lastIndexOf(name, "shared") : indexOf(name, "rest");
  }
  return (
    <div style={{ position: "absolute", inset: 0 }}>
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
  let menu: ReactNode = null;
  if (pane.who === "priya") {
    if (b < m.reorderArrive) {
      src = "story-1-act-priya";
      const fs = scene(src).frames;
      const first = indexOf(src, "type");
      const n = fs.filter((f) => f.label === "type").length;
      if (b < m.renameField) index = indexOf(src, "rest");
      else if (b < m.renameType) index = indexOf(src, "field");
      else if (b < m.renameCommit) index = first + Math.min(n - 1, Math.floor(((b - m.renameType) / (m.renameCommit - m.renameType - 0.1)) * n));
      else index = byTime(src, ["commit", "settle", "after"], fs[indexOf(src, "commit")].t, SLOW, (b - m.renameCommit) * BEAT_MS);
    } else {
      src = "story-2-watch-priya";
      ({ index, overlay, halo } = arrival(src, b, m.reorderArrive));
      haloAt = m.reorderArrive;
    }
  } else {
    if (b < m.reorderGrab) {
      src = "story-1-watch-tomas";
      ({ index, overlay, halo } = arrival(src, b, m.renameArrive, { rename: /heatmap/ }));
      haloAt = m.renameArrive;
      if (b >= m.reorderGrab - 1.3) {
        const g = fr("story-2-act-tomas", indexOf("story-2-act-tomas", "drag:grab")).ptr;
        if (g) {
          const t = easeInOut(clamp((b - (m.reorderGrab - 1.2)) / 1.1));
          pointer = { x: mix(g[0] + 90, g[0], t), y: mix(g[1] + 140, g[1], t), press: 0 };
        }
      }
    } else {
      src = "story-2-act-tomas";
      index = dragIndex(src, b, m.reorderGrab, m.reorderUp);
      pointer = b < m.reorderUp + 2.6 ? dragPointer(src, index, b, m.reorderUp, m.reorderGrab) : null;
    }
  }
  return (
    <Screen id={pane.id} src={src} index={index} view={cam} tag={who.name} tagColor={who.color}>
      {overlay}
      <Halo rect={halo} b={b} at={haloAt} color={who.color} />
      {menu}
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
  const push = 1 + CHAT_PUSH * seg(b, 0, 16, (x) => x);
  const width = object.number("width");
  return (
    <Paper>
      <Box id={box.id} style={{ scale: String(push) }}>
        <ChatApp b={b} width={width} height={object.number("height")} state={chatState(b, shot.marks!)} port={aspect === "port"} pointer={chatPointer(b, width, shot.marks!.panel)} />
      </Box>
      <Supers />
    </Paper>
  );
}

const CHAT_PUSH = 0.03;
function chatPointer(b: number, width: number, click: number) {
  const c = badgeCenter(width);
  return pointerPath(b, [
    { at: click - 0.6, x: c.x - 90, y: c.y + 250 },
    { at: click, x: c.x, y: c.y, click: true },
    { at: click + 1.1, x: c.x - 30, y: c.y + 140 },
  ], 0.5);
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
  const port = aspect === "port";
  const pane = shot.panes![0];
  const cam = useCam(pane);
  const object = useStudioObject(pane.id);
  const chatObject = useStudioObject("chat-app");
  const box = { x: object.number("x"), y: object.number("y"), w: object.number("width"), h: object.number("height") };
  const chatBox = { x: chatObject.number("x"), y: chatObject.number("y"), w: chatObject.number("width"), h: chatObject.number("height") };
  const name = pane.scene!;
  const { lift, land, stagger, chatOut, rise } = shot.marks!;
  const shared = lastIndexOf(name, "shared");
  const rows = Object.entries(fr(name, shared).rows ?? {}).filter((e): e is [string, Rect] => !!e[1] && e[1].x < 250).sort((a, b2) => a[1].y - b2[1].y);
  const header = rows.find(([, r]) => r.x < 20);
  const stop = rows.find(([, r]) => header && r.x < 20 && r.y > header[1].y);
  const links = rows.filter(([, r]) => header && r.x >= 20 && r.y > header[1].y && (!stop || r.y < stop[1].y));
  const tint = tintOf(name);
  const chatB = 16;
  const state = { thread: 0, switchAt: -1, scroll: 0, links: THREADS[0].links + 1, panel: 1 };
  const cards = panelLayout(chatBox.w, port);
  const k = 1 + CHAT_PUSH;
  const fromChat = (x: number, y: number) => ({ x: chatBox.x + chatBox.w / 2 + (x - chatBox.w / 2) * k, y: chatBox.y + chatBox.h / 2 + (y - chatBox.h / 2) * k });
  const lastLift = lift + (links.length - 1) * stagger;
  const fade = 1 - sineInOut(clamp((b - lastLift - 0.25) / chatOut));
  const up = sineInOut(clamp((b - rise) / 1.2));
  const landed = (i: number) => (b >= lift + i * stagger + land ? 1 : 0);
  const lifted = TURN_LINKS.filter((_, i) => b >= lift + i * stagger).map((l) => l.host);
  const pointer = chatPointer(b + chat.beats, chatBox.w, chat.marks!.panel);
  return (
    <Paper>
      {fade > 0.005 ? (
        <div style={{ position: "absolute", inset: 0, opacity: fade, scale: String(mix(0.96, 1, fade)) }}>
          <Box id="chat-app" style={{ scale: String(k) }}>
            <ChatApp b={chatB} width={chatBox.w} height={chatBox.h} state={state} port={port} hide={lifted} pointer={pointer} />
          </Box>
        </div>
      ) : null}
      {up > 0.005 ? (
        <div style={{ position: "absolute", inset: 0, opacity: up, translate: `0 ${(1 - up) * 30}px` }}>
          <Screen id={pane.id} src={name} index={shared} view={cam} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
            {links.map(([id, r], i) => (
              <div key={id} style={{ position: "absolute", left: 0, top: r.y - 1.5, width: 250, height: r.height + 3, opacity: 1 - landed(i), backgroundImage: `linear-gradient(to bottom, ${tint[0]}, ${tint[1]})`, backgroundSize: `250px ${WIN_PT[1]}px`, backgroundPosition: `0 ${-(r.y - 1.5)}px` }} />
            ))}
            {header ? <Halo rect={header[1]} b={b} at={lift + land + (links.length - 1) * stagger} color={PEOPLE.priya.color} /> : null}
          </Screen>
        </div>
      ) : null}
      {links.map(([id, r], i) => {
        const link = TURN_LINKS[i];
        const card = link ? cards.find((c) => c.link.host === link.host) : null;
        if (!link || !card) return null;
        const start = lift + i * stagger;
        const t = sineInOut(clamp((b - start) / land));
        if (b < start || landed(i) >= 1) return null;
        const from = fromChat(card.x, card.y);
        const fromW = card.w * k;
        const target = toFrame(box, cam, { x: r.x + 4, y: r.y });
        const targetW = (r.width - 8) * cam.s;
        const w = mix(fromW, targetW, t);
        const x = mix(from.x, target.x, t);
        const y = mix(from.y, target.y, t) - Math.sin(Math.PI * t) * 60;
        const lifting = Math.min(1, t * 5) * (1 - t);
        const h = mix((fromW * CARD_H) / 600, r.height * cam.s, t);
        const sx = w / (r.width - 8);
        const sy = h / r.height;
        const rowLook = seg(b, start + land * 0.68, land * 0.27);
        return (
          <div key={id} style={{ position: "absolute", left: x, top: y, width: w, opacity: 1 - landed(i), filter: `drop-shadow(0 ${18 * lifting}px ${30 * lifting}px rgba(0,0,0,0.18))` }}>
            <div style={{ position: "relative", width: w, height: h, overflow: "hidden", borderRadius: mix((34 * fromW) / 600, 0, t) }}>
              <div style={{ opacity: 1 - rowLook }}>
                <LinkCard link={link} width={w} />
              </div>
              {rowLook > 0 ? (
                <div style={{ position: "absolute", inset: 0, opacity: rowLook, overflow: "hidden" }}>
                  <Img src={footageSrc(name, shared)} style={{ position: "absolute", left: -(r.x + 4) * sx, top: -r.y * sy, width: WIN_PT[0] * sx, height: WIN_PT[1] * sy, maxWidth: "none" }} />
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <Supers />
    </Paper>
  );
}

function AcceptShot() {
  const shot = useShot();
  const b = useBeat();
  const pane = shot.panes![0];
  const cam = useCam(pane);
  const name = pane.scene!;
  const items = (scene(name).menu ?? []) as MenuEntry[];
  const m = shot.marks!;
  const rowsB = Object.values(fr(name, indexOf(name, "rest")).rows ?? {}).filter((r): r is Rect => !!r);
  const bottom = rowsB.length ? Math.max(...rowsB.map((r) => r.y + r.height)) + 60 : 220;
  const mx = 120;
  const my = bottom;
  const target = menuRowTop(items, "addShared");
  const p = pointerPath(b, [
    { at: m.menu - 0.1, x: mx, y: my },
    { at: m.menu, x: mx, y: my, click: true },
    { at: m.pick - 0.3, x: mx + 110, y: my + target },
    { at: m.pick, x: mx + 110, y: my + target, click: true },
    { at: m.arrive + 1.6, x: mx + 200, y: my + 240 },
  ], 0.8);
  const arr = arrival(name, b, m.arrive, { before: "rest", after: "added" });
  return (
    <Paper>
      <Screen id={pane.id} src={name} index={arr.index} view={cam} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
        {arr.overlay}
        <MacMenu items={items} x={mx + 3} y={my + 2} b={b} open={m.menu + 0.05} close={m.pick + 0.25} hover={b >= m.pick - 0.5 ? "addShared" : null} flash={m.pick} />
        <Halo rect={arr.halo} b={b} at={m.arrive} color={PEOPLE.tomas.color} />
        {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
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
  const files = (scene("story-share-priya") as unknown as { files?: string[] }).files ?? [];
  const show = 1;
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
              const t = 0.35 + 0.65 * seg(b, 0.2 + i * 0.16, 0.5);
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
          width={object.number("width")}
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
  const lock = shot.marks!.lockup;
  const s = easeOut(clamp((b - lock) / 0.6));
  const bob = Math.sin(b * 1.1) * 4;
  const push = 1 + 0.025 * seg(b, 0, shot.beats, (x) => x);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, scale: String(push) }}>
        <Box id={shot.panes![0].id} style={{ scale: String(mix(0.94, 1, s)), opacity: b >= lock ? 1 : 0, translate: `0 ${bob}px` }}>
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
  accept: AcceptShot,
  files: FilesShot,
  callback: CallbackShot,
  end: EndShot,
};
