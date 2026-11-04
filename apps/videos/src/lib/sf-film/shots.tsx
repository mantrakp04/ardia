import type { ComponentType, CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import { color } from "../ac-launch/theme";
import {
  byTime, camAt, clamp, easeIn, easeInOut, easeOut, indexOf, kick, lastIndexOf, mix, Paper, Pointer, pointerPath, scene, Screen, seg, springAt,
  Supers, useAspect, useBeat, useShot, type Frame,
} from "./kit";
import { Morph, planMorph, type Rect, type Rows, targetAt } from "./morph";
import { ChatWindow, Halo, MacBanner, MacMenu, type MenuEntry, menuRowTop, SharePicker, SHEET_PICK } from "./parts";
import { PEOPLE, type ScreenLayer, type ShotKind } from "./plan";

const SLOW = 5;
const BEAT_MS = 500;

function useCam(layer: ScreenLayer | undefined) {
  const aspect = useAspect();
  const b = useBeat();
  return camAt(layer?.cam?.[aspect] ?? [{ at: 0 }], b);
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

function inferredBefore(after: Rows): Rows {
  const list = Object.entries(after).filter((e): e is [string, Rect] => !!e[1]).sort((a, b) => a[1].y - b[1].y);
  const head = list[0];
  const firstOwn = list.find(([id]) => /^b\d$/.test(id));
  if (!head || !firstOwn) return {};
  const shift = firstOwn[1].y - head[1].y;
  return Object.fromEntries(list.filter(([id]) => /^b\d$/.test(id)).map(([id, r]) => [id, { ...r, y: r.y - shift }]));
}

interface Arrival {
  index: number;
  overlay: ReactNode;
  halo: Rect | null;
}
function arrival(name: string, b: number, at: number, opts: { before?: string; after?: string; rename?: RegExp } = {}): Arrival {
  const beforeLabel = opts.before ?? "arrive:before";
  const afterLabel = opts.after ?? (has(name, "settled") ? "settled" : "arrive");
  const rowsLabel = opts.after ?? (has(name, "settled") ? "settled" : "after");
  const before = indexOf(name, beforeLabel);
  const after = lastIndexOf(name, afterLabel);
  const rowsA = fr(name, lastIndexOf(name, rowsLabel)).rows ?? {};
  const rest = fr(name, indexOf(name, "rest")).rows;
  const rowsB = rest && Object.keys(rest).length ? rest : inferredBefore(rowsA);
  const plan = opts.rename ? null : planMorph(rowsB, rowsA);
  if (!plan) {
    const halo = opts.rename ? linkRow(name, opts.rename, rowsLabel) : null;
    return { index: b < at ? before : after, overlay: null, halo: b >= at ? halo : null };
  }
  const dur = plan.from ? 0.7 : 0.55;
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
  if (b < up) {
    const steps = ups - down;
    return down + Math.min(steps - 1, Math.floor(((b - grab) / (up - grab)) * steps));
  }
  const t0 = fs[ups].up ?? fs[ups].t;
  const ms = (b - up) * BEAT_MS;
  return ms > 1200 ? lastIndexOf(name, "after") : byTime(name, ["drag:up", "settle"], t0, SLOW, ms);
}
function dragPointer(name: string, i: number, b: number, up: number, grab: number) {
  const f = fr(name, i);
  if (f.ptr && b >= grab) return { x: f.ptr[0], y: f.ptr[1], press: f.press ?? 0 };
  const g = fr(name, indexOf(name, "drag:grab")).ptr;
  const lastUp = fr(name, indexOf(name, "drag:up")).ptr;
  if (b >= up && lastUp) return { x: lastUp[0] + 12 * seg(b, up + 0.6, 1), y: lastUp[1] + 18 * seg(b, up + 0.6, 1), press: 0 };
  if (!g) return null;
  const t = easeOut(clamp((b - (grab - 0.9)) / 0.9));
  return { x: mix(g[0] + 60, g[0], t), y: mix(g[1] + 90, g[1], t), press: 0 };
}

function ChatShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const box = shot.screens![0];
  const object = useStudioObject(box.id);
  const zoom = mix(aspect === "land" ? 1.75 : 1.6, aspect === "land" ? 1.45 : 1.35, seg(b, 0.6, 1.4, easeInOut));
  const push = easeIn(clamp((b - shot.marks!.push) / (shot.beats - shot.marks!.push)));
  return (
    <Paper>
      <Box id={box.id}>
        <ChatWindow b={b} width={object.number("width")} height={object.number("height")} zoom={zoom} push={push} />
      </Box>
      <Supers />
    </Paper>
  );
}

function FolderShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const head = fr(name, indexOf(name, "rest")).head!;
  const menu = (scene(name).menu ?? []) as MenuEntry[];
  const hx = head.x + 96;
  const hy = head.y + head.height / 2;
  const target = menuRowTop(menu, "shareFolder");
  const p = pointerPath(b, [
    { at: 1.3, x: hx, y: hy },
    { at: 1.5, x: hx, y: hy, click: true },
    { at: 2.5, x: hx + 124, y: hy + 2 + target },
    { at: 3, x: hx + 124, y: hy + 2 + target, click: true },
  ], 0.6);
  const index = b < 1.2 ? indexOf(name, "rest") : indexOf(name, "hover");
  return (
    <Paper>
      <Screen id={shot.screens![0].id} src={name} index={index} view={cam} radius={24} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
        <MacMenu items={menu} x={hx + 4} y={hy + 2} b={b} open={1.55} close={3.25} hover={b >= 2.35 ? "shareFolder" : null} flash={3} />
        {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
      <Supers />
    </Paper>
  );
}

function ShareShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const head = fr(name, indexOf(name, "rest")).head!;
  const sx = head.x + head.width + 18;
  const sy = head.y - 18;
  const pickX = sx + SHEET_PICK.x;
  const pickY = sy + SHEET_PICK.y;
  const p = pointerPath(b, [
    { at: 0, x: head.x + 220, y: head.y + 160 },
    { at: 1.5, x: sx + 60, y: sy + 80 },
    { at: 1.5, x: sx + 60, y: sy + 80, click: true },
    { at: 2.5, x: pickX, y: pickY },
    { at: 2.5, x: pickX, y: pickY, click: true },
    { at: 3.6, x: pickX + 90, y: pickY + 160 },
  ], 0.5);
  const index = b < 2.85 ? indexOf(name, "hover") : lastIndexOf(name, "shared");
  const glyph = fr(name, lastIndexOf(name, "shared")).head ?? head;
  return (
    <Paper>
      <Screen id={shot.screens![0].id} src={name} index={index} view={cam} radius={24} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
        <SharePicker x={sx} y={sy} b={b} open={0} close={2.75} pick={2.5} tick={1.5} />
        <Halo rect={{ x: glyph.x + 2, y: glyph.y + 1, width: glyph.width - 4, height: glyph.height - 2 }} b={b} at={3} color={PEOPLE.priya.color} />
        {p && b < 3.4 ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
      <Supers />
    </Paper>
  );
}

function InviteShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const { banner, click } = shot.marks!;
  const bx = 1280 - 344 - 14;
  const p = pointerPath(b, [
    { at: banner + 0.35, x: 1030, y: 330 },
    { at: click, x: bx + 200, y: 44 },
    { at: click, x: bx + 200, y: 44, click: true },
  ], 0.55);
  return (
    <Paper>
      <Screen id={shot.screens![0].id} src={name} index={indexOf(name, "rest")} view={cam} radius={24} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
        <MacBanner x={bx} y={12} b={b} at={banner} out={click + 0.2} title="Priya" body="Invited you to collaborate on “Thesis Reading”." />
        {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
    </Paper>
  );
}

function AcceptShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const menu = (scene(name).menu ?? []) as MenuEntry[];
  const { menu: open, pick, arrive } = shot.marks!;
  const mx = 120;
  const my = 232;
  const target = menuRowTop(menu, "addShared");
  const p = pointerPath(b, [
    { at: open - 0.2, x: mx, y: my },
    { at: open, x: mx, y: my, click: true },
    { at: pick - 0.4, x: mx + 110, y: my + target },
    { at: pick, x: mx + 110, y: my + target, click: true },
    { at: arrive + 1.2, x: mx + 190, y: my + 200 },
  ], 0.5);
  const arr = arrival(name, b, arrive, { before: "rest", after: "added" });
  return (
    <Paper>
      <Screen id={shot.screens![0].id} src={name} index={arr.index} view={cam} radius={24} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
        {arr.overlay}
        <MacMenu items={menu} x={mx + 3} y={my + 2} b={b} open={open + 0.05} close={pick + 0.25} hover={b >= open + 0.45 ? "addShared" : null} flash={pick} />
        <Halo rect={arr.halo} b={b} at={arrive} color={PEOPLE.tomas.color} />
        {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
      <Supers />
    </Paper>
  );
}

function DuoShot() {
  const shot = useShot();
  const b = useBeat();
  const [left, right] = shot.screens!;
  const camA = useCam(left);
  const camB = useCam(right);
  const { grab, up, arrive } = shot.marks!;
  const ia = dragIndex("sf-drop", b, grab, up);
  const pa = dragPointer("sf-drop", ia, b, up, grab);
  const arr = arrival("sf-watch-drop", b, arrive);
  const k = kick(b, arrive, 0.25);
  return (
    <Paper>
      <Screen id={left.id} src="sf-drop" index={ia} view={camA} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
        {pa ? <Pointer x={pa.x} y={pa.y} press={pa.press} /> : null}
      </Screen>
      <div style={{ position: "absolute", inset: 0, scale: String(1 + 0.012 * k), transformOrigin: "75% 55%" }}>
        <Screen id={right.id} src="sf-watch-drop" index={arr.index} view={camB} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
          {arr.overlay}
          <Halo rect={arr.halo} b={b} at={arrive} color={PEOPLE.tomas.color} />
        </Screen>
      </div>
      <Supers />
    </Paper>
  );
}

const CAUSE_SCENES: Record<string, "drag" | "type" | "nest"> = { "sf-back": "drag", "sf-reorder": "drag", "sf-rename": "type", "sf-sub": "nest" };
function CauseShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const who = PEOPLE[shot.who!];
  const mode = CAUSE_SCENES[name];
  const fs = scene(name).frames;
  let index = 0;
  let p: { x: number; y: number; press: number } | null = null;
  if (mode === "drag") {
    const { grab, up } = shot.marks!;
    index = dragIndex(name, b, grab, up);
    p = dragPointer(name, index, b, up, grab);
  } else if (mode === "type") {
    const { type, commit } = shot.marks!;
    const first = indexOf(name, "type");
    const n = fs.filter((f) => f.label === "type").length;
    if (b < type) index = indexOf(name, "field");
    else if (b < commit) index = first + Math.min(n - 1, Math.floor(((b - type) / (commit - type - 0.15)) * n));
    else index = byTime(name, ["commit", "settle"], fs[indexOf(name, "commit")].t, SLOW, (b - commit) * BEAT_MS);
  } else {
    const first = indexOf(name, "nest");
    index = b < shot.marks!.nest ? indexOf(name, "rest") : byTime(name, ["nest"], fs[first].t, SLOW, (b - shot.marks!.nest) * BEAT_MS);
  }
  return (
    <Paper>
      <Screen id={shot.screens![0].id} src={name} index={index} view={cam} tag={who.name} tagColor={who.color}>
        {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
      </Screen>
      <Supers />
    </Paper>
  );
}

const RENAMED: Record<string, RegExp> = { "sf-watch-rename": /heatmap/ };
function EffectShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const who = PEOPLE[shot.who!];
  const at = shot.marks!.arrive;
  const arr = arrival(name, b, at, { rename: RENAMED[name] });
  const k = kick(b, at, 0.22);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, scale: String(1 + 0.01 * k) }}>
        <Screen id={shot.screens![0].id} src={name} index={arr.index} view={cam} tag={who.name} tagColor={who.color}>
          {arr.overlay}
          <Halo rect={arr.halo} b={b} at={at} color={who.color} />
        </Screen>
      </div>
      <Supers />
    </Paper>
  );
}

function Pair({ veil = 0 }: { veil?: number }) {
  const shot = useShot();
  const [left, right] = shot.screens!;
  const camA = useCam(left);
  const camB = useCam(right);
  return (
    <>
      <Screen id={left.id} src="sf-sub" index={lastIndexOf("sf-sub", "after")} view={camA} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color} />
      <Screen id={right.id} src="sf-watch-sub" index={lastIndexOf("sf-watch-sub", "after")} view={camB} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color} />
      {veil > 0 ? <AbsoluteFill style={{ backgroundColor: color.paper, opacity: veil }} /> : null}
    </>
  );
}

function SameShot() {
  return (
    <Paper>
      <Pair />
      <Supers />
    </Paper>
  );
}

function WordsShot() {
  return <Supers />;
}

function NosShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const away = easeIn(clamp((b - 3.6) / 0.4));
  const listing = (scene("sf-sub") as unknown as { files?: string[] }).files ?? [];
  const files = listing.slice(1, listing.indexOf("") < 0 ? undefined : listing.indexOf(""));
  const show = seg(b, 4.1, 0.6);
  return (
    <Paper>
      {b < 4 ? (
        <div style={{ position: "absolute", inset: 0, translate: `0 ${away * (aspect === "land" ? 1100 : 1900)}px` }}>
          <Pair veil={0.35} />
        </div>
      ) : null}
      {b >= 4 ? (
        <Box id={shot.screens![2].id} style={{ opacity: show, translate: `0 ${(1 - show) * 60}px` }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 26, backgroundColor: "#FFFFFF", boxShadow: "0 14px 40px rgba(22,19,15,0.18)", padding: 30, fontFamily: '-apple-system, "SF Pro Text", sans-serif' }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <Img src={staticFile("brand/sf/folder-plain.png")} style={{ width: 92, height: 92 }} />
              <div>
                <div style={{ fontSize: 38, fontWeight: 700, color: "#1E1A16" }}>Thesis Reading</div>
                <div style={{ fontSize: 22, color: "#7B7368", marginTop: 2 }}>Shared · iCloud Drive</div>
              </div>
            </div>
            <div style={{ marginTop: 22 }}>
              {files.map((n, i) => {
                const dir = !n.endsWith(".webloc");
                return (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 14, height: 62, borderTop: i ? "1px solid #F0EBE2" : "none", fontSize: 27, color: "#2A2521", opacity: seg(b, 4.4 + i * 0.1, 0.3), translate: `${(1 - seg(b, 4.4 + i * 0.1, 0.4)) * 30}px 0` }}>
                    <Img src={staticFile(dir ? "brand/sf/folder-plain.png" : "brand/sf/sym-link.png")} style={{ width: dir ? 30 : 22, height: dir ? 30 : 22, opacity: dir ? 1 : 0.5 }} />
                    {n}
                  </div>
                );
              })}
            </div>
          </div>
        </Box>
      ) : null}
      <Supers />
    </Paper>
  );
}

const END_REPLAYS: { scene: string; who: "priya" | "tomas"; mark: string }[] = [
  { scene: "sf-watch-drop", who: "tomas", mark: "first" },
  { scene: "sf-watch-back", who: "priya", mark: "second" },
  { scene: "sf-watch-sub", who: "tomas", mark: "third" },
];
function EndShot() {
  const shot = useShot();
  const b = useBeat();
  const s = springAt(b, 0, { stiffness: 300, damping: 20 });
  const bob = Math.sin(b * 1.2) * 6;
  const live = shot.screens![1];
  const cam = useCam(live);
  const marks = shot.marks!;
  const k = [...END_REPLAYS].reverse().findIndex((r) => b >= marks[r.mark] - 0.5);
  const replay = k < 0 ? END_REPLAYS[0] : END_REPLAYS[END_REPLAYS.length - 1 - k];
  const at = marks[replay.mark];
  const arr = arrival(replay.scene, b, at);
  const who = PEOPLE[replay.who];
  const push = 1 + 0.035 * seg(b, 0, 12, (x) => x);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, scale: String(push), transformOrigin: "30% 50%" }}>
        <Box id={shot.screens![0].id} style={{ scale: String(mix(0.6, 1, s)), opacity: clamp(s * 2), translate: `0 ${bob}px` }}>
          <Img src={staticFile("brand/app-icon.png")} style={{ width: "100%", height: "100%", filter: "drop-shadow(0 14px 22px rgba(22,19,15,0.25))" }} />
        </Box>
        <Supers />
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: seg(b, 0.1, 0.4) }}>
        <Screen id={live.id} src={replay.scene} index={arr.index} view={cam} tag={who.name} tagColor={who.color}>
          {arr.overlay}
          <Halo rect={arr.halo} b={b} at={at} color={who.color} />
        </Screen>
      </div>
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  chat: ChatShot,
  folder: FolderShot,
  share: ShareShot,
  invite: InviteShot,
  accept: AcceptShot,
  duo: DuoShot,
  cause: CauseShot,
  effect: EffectShot,
  same: SameShot,
  words: WordsShot,
  nos: NosShot,
  end: EndShot,
};
