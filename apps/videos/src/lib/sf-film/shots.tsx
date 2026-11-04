import type { ComponentType, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { useStudioObject } from "../studio-objects-v6";
import { color } from "../ac-launch/theme";
import {
  byTime, camAt, clamp, easeIn, indexOf, kick, lastIndexOf, mix, Paper, Pointer, pointerPath, scene, Screen, seg, springAt,
  Supers, useAspect, useBeat, useShot, type Frame,
} from "./kit";
import { ChatWindow, Halo, MacMenu, type MenuEntry, menuRowTop, SharePicker, SHEET_PICK } from "./parts";
import { PEOPLE, type ScreenLayer, type ShotKind } from "./plan";

const SLOW = 5;
const BEAT_MS = 500;

function useCam(layer: ScreenLayer | undefined) {
  const aspect = useAspect();
  const b = useBeat();
  return camAt(layer?.cam?.[aspect] ?? [{ at: 0 }], b);
}

function Box({ id, children, style }: { id: string; children?: ReactNode; style?: React.CSSProperties }) {
  const object = useStudioObject(id);
  const geometry = object.geometry({ x: "x", y: "y", width: "width", height: "height", rotation: "rotation" });
  return (
    <div {...object.bind} {...geometry.bind} style={{ ...geometry.style, ...style }}>
      {children}
    </div>
  );
}

const fr = (name: string, i: number): Frame => scene(name).frames[Math.max(0, Math.min(scene(name).frames.length - 1, i))];
const linkRow = (name: string, match: RegExp) => {
  const s = scene(name) as unknown as { links?: [string, string, string][]; frames: Frame[] };
  const after = s.frames[lastIndexOf(name, "after")].rows ?? {};
  const before = s.frames[indexOf(name, "rest")].rows ?? {};
  const fresh = Object.entries(after).find(([id, r]) => r && !before[id]);
  if (fresh) return fresh[1];
  const id = s.links?.find(([, , u]) => match.test(u))?.[0];
  return id ? after[id] : null;
};

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
  const settle = byTime(name, ["drag:up", "settle"], t0, SLOW, ms);
  return ms > 900 ? lastIndexOf(name, "after") : settle;
}
function dragPointer(name: string, i: number, b: number, up: number) {
  const f = fr(name, i);
  if (f.ptr) return { x: f.ptr[0], y: f.ptr[1], press: f.press ?? 0 };
  const lastUp = fr(name, indexOf(name, "drag:up")).ptr;
  if (b >= up && lastUp) return { x: lastUp[0] + 10 * seg(b, up, 1), y: lastUp[1] + 14 * seg(b, up, 1), press: 0 };
  const grab = fr(name, indexOf(name, "drag:grab")).ptr;
  return grab ? { x: grab[0] + 40 * (1 - seg(b, 0, 0.8)), y: grab[1] + 60 * (1 - seg(b, 0, 0.8)), press: 0 } : null;
}
function arriveIndex(name: string, b: number, arrive: number) {
  const fs = scene(name).frames;
  if (b < arrive) return indexOf(name, "arrive:before");
  const first = indexOf(name, "arrive");
  const seen = fs[first].seen ?? fs[first].t;
  const ms = (b - arrive) * BEAT_MS + 40;
  if (ms > 1600) return lastIndexOf(name, "after");
  return byTime(name, ["arrive"], seen, SLOW, ms);
}

function ChatShot() {
  const shot = useShot();
  const b = useBeat();
  const aspect = useAspect();
  const out = seg(b, 7.45, 0.55, easeIn);
  const box = shot.screens![0];
  const object = useStudioObject(box.id);
  const centre = aspect === "land" ? 960 - (object.number("x") + object.number("width") / 2) : 0;
  const aside = springAt(b, 3.85, { stiffness: 240, damping: 24 });
  const dx = centre * (1 - aside) - out * (aspect === "land" ? 1500 : 1300);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, translate: `${dx}px 0`, rotate: `${-out * 4}deg` }}>
        <Box id={box.id}>
          <ChatWindow b={b} width={object.number("width")} height={object.number("height")} />
        </Box>
      </div>
      <div style={{ position: "absolute", inset: 0, opacity: 1 - out }}>
        <Supers />
      </div>
    </Paper>
  );
}

function enterX(b: number, from = 0) {
  return (1 - springAt(b, from, { stiffness: 210, damping: 24 })) * 1300;
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
  const mx = hx + 4;
  const my = hy + 2;
  const target = menuRowTop(menu, "shareFolder");
  const p = pointerPath(b, [
    { at: 1.3, x: hx, y: hy },
    { at: 1.5, x: hx, y: hy, click: true },
    { at: 2.5, x: mx + 120, y: my + target },
    { at: 3, x: mx + 120, y: my + target, click: true },
  ], 0.6);
  const index = b < 1.2 ? indexOf(name, "rest") : indexOf(name, "hover");
  const hover = b >= 2.35 ? "shareFolder" : null;
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, translate: `${enterX(b, -0.1)}px 0` }}>
        <Screen id={shot.screens![0].id} src={name} index={index} view={cam} radius={24} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
          <MacMenu items={menu} x={mx} y={my} b={b} open={1.55} close={3.25} hover={hover} flash={3} />
          {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
        </Screen>
      </div>
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

function AcceptShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const menu = (scene(name).menu ?? []) as MenuEntry[];
  const fs = scene(name).frames;
  const mx = 120;
  const my = 296;
  const target = menuRowTop(menu, "addShared");
  const p = pointerPath(b, [
    { at: 0.8, x: mx, y: my },
    { at: 1, x: mx, y: my, click: true },
    { at: 1.6, x: mx + 110, y: my + target },
    { at: 2, x: mx + 110, y: my + target, click: true },
    { at: 3.4, x: mx + 190, y: my + 200 },
  ], 0.5);
  let index = indexOf(name, "rest");
  if (b >= 2.5) {
    const first = fs.findIndex((f) => f.label === "adding" && f.has);
    const t0 = first >= 0 ? fs[first].t : fs[indexOf(name, "adding")].t;
    const ms = (b - 2.5) * BEAT_MS;
    index = ms > 1400 ? lastIndexOf(name, "added") : byTime(name, ["adding"], t0, SLOW, ms);
  }
  const added = fs[lastIndexOf(name, "added")].rows;
  const groupRect = added ? Object.values(added).find((r) => r && r.y < 120 && r.height > 20) : null;
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, translate: `${enterX(b, -0.1)}px 0` }}>
        <Screen id={shot.screens![0].id} src={name} index={index} view={cam} radius={24} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
          <MacMenu items={menu} x={mx + 3} y={my + 2} b={b} open={1.05} close={2.25} hover={b >= 1.45 ? "addShared" : null} flash={2} />
          <Halo rect={groupRect} b={b} at={2.5} color={PEOPLE.tomas.color} />
          {p ? <Pointer x={p.x} y={p.y} press={p.press} /> : null}
        </Screen>
      </div>
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
  const pa = dragPointer("sf-drop", ia, b, up);
  const ib = arriveIndex("sf-watch-drop", b, arrive);
  const k = kick(b, arrive, 0.25);
  return (
    <Paper>
      <Screen id={left.id} src="sf-drop" index={ia} view={camA} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color}>
        {pa ? <Pointer x={pa.x} y={pa.y} press={pa.press} /> : null}
      </Screen>
      <div style={{ position: "absolute", inset: 0, scale: String(1 + 0.012 * k), transformOrigin: "75% 55%" }}>
        <Screen id={right.id} src="sf-watch-drop" index={ib} view={camB} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color}>
          <Halo rect={linkRow("sf-watch-drop", /heatmap/)} b={b} at={arrive} color={PEOPLE.tomas.color} />
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
  let index = 0;
  let p: { x: number; y: number; press: number } | null = null;
  if (mode === "drag") {
    index = dragIndex(name, b, shot.marks!.grab, shot.marks!.up);
    p = dragPointer(name, index, b, shot.marks!.up);
  } else if (mode === "type") {
    const { type, commit } = shot.marks!;
    const fs = scene(name).frames;
    const first = indexOf(name, "type");
    const n = fs.filter((f) => f.label === "type").length;
    if (b < type) index = indexOf(name, "field");
    else if (b < commit) index = first + Math.min(n - 1, Math.floor(((b - type) / (commit - type - 0.15)) * n));
    else {
      const c = indexOf(name, "commit");
      index = byTime(name, ["commit", "settle"], fs[c].t, SLOW, (b - commit) * BEAT_MS);
    }
  } else {
    const fs = scene(name).frames;
    const first = indexOf(name, "nest");
    index = byTime(name, ["nest"], fs[first].t, SLOW, (b - shot.marks!.nest) * BEAT_MS);
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

const EFFECT_MATCH: Record<string, RegExp> = { "sf-watch-back": /lecture/, "sf-watch-rename": /heatmap/, "sf-watch-reorder": /library/ };
function EffectShot() {
  const shot = useShot();
  const b = useBeat();
  const cam = useCam(shot.screens![0]);
  const name = shot.scene!;
  const who = PEOPLE[shot.who!];
  const arrive = shot.marks!.arrive;
  const index = arriveIndex(name, b, arrive);
  const rect = linkRow(name, EFFECT_MATCH[name] ?? /^$/);
  const k = kick(b, arrive, 0.22);
  return (
    <Paper>
      <div style={{ position: "absolute", inset: 0, scale: String(1 + 0.01 * k) }}>
        <Screen id={shot.screens![0].id} src={name} index={index} view={cam} tag={who.name} tagColor={who.color}>
          <Halo rect={rect} b={b} at={arrive} color={who.color} />
        </Screen>
      </div>
      <Supers />
    </Paper>
  );
}

function SameShot() {
  const shot = useShot();
  const [left, right] = shot.screens!;
  const camA = useCam(left);
  const camB = useCam(right);
  return (
    <Paper>
      <Screen id={left.id} src="sf-sub" index={lastIndexOf("sf-sub", "after")} view={camA} tag={PEOPLE.priya.name} tagColor={PEOPLE.priya.color} />
      <Screen id={right.id} src="sf-watch-sub" index={lastIndexOf("sf-watch-sub", "after")} view={camB} tag={PEOPLE.tomas.name} tagColor={PEOPLE.tomas.color} />
      <Supers />
    </Paper>
  );
}

function NosShot() {
  const shot = useShot();
  const b = useBeat();
  const dark = b < 4;
  const listing = (scene("sf-sub") as unknown as { files?: string[] }).files ?? [];
  const files = listing.slice(1, listing.indexOf("") < 0 ? undefined : listing.indexOf(""));
  const show = seg(b, 4.25, 0.6);
  return (
    <Paper tone={dark ? (b < 2 ? color.ink : color.stamp) : color.paper}>
      {!dark ? (
        <Box id={shot.screens![0].id} style={{ opacity: show, translate: `0 ${(1 - show) * 40}px` }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 26, backgroundColor: "#FFFFFF", boxShadow: "0 14px 40px rgba(22,19,15,0.18)", padding: 26, fontFamily: '-apple-system, "SF Pro Text", sans-serif' }}>
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
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 14, height: 62, borderTop: i ? "1px solid #F0EBE2" : "none", fontSize: 27, color: "#2A2521", opacity: seg(b, 4.5 + i * 0.1, 0.3) }}>
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

function EndShot() {
  const shot = useShot();
  const b = useBeat();
  const s = springAt(b, 0, { stiffness: 300, damping: 20 });
  const breathe = 1 + 0.012 * Math.sin(b * 1.3);
  return (
    <Paper>
      <Box id={shot.screens![0].id} style={{ scale: String(mix(0.6, 1, s) * breathe), opacity: clamp(s * 2) }}>
        <Img src={staticFile("brand/app-icon.png")} style={{ width: "100%", height: "100%", filter: "drop-shadow(0 14px 22px rgba(22,19,15,0.25))" }} />
      </Box>
      <Supers />
    </Paper>
  );
}

export const SHOTS: Record<ShotKind, ComponentType> = {
  chat: ChatShot,
  folder: FolderShot,
  share: ShareShot,
  accept: AcceptShot,
  duo: DuoShot,
  cause: CauseShot,
  effect: EffectShot,
  same: SameShot,
  nos: NosShot,
  end: EndShot,
};
