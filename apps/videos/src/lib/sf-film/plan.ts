export const BEAT = 18;
export const f = (beat: number) => Math.round(beat * BEAT);
export const WIN_PT: readonly [number, number] = [1280, 800];
export const SIDEBAR_PT = 249;

export type Aspect = "land" | "port";
export type Box = readonly [x: number, y: number, width: number, height: number];
export const FRAME: Record<Aspect, readonly [number, number]> = { land: [1920, 1080], port: [1080, 1920] };

export interface View {
  cx: number;
  cy: number;
  s: number;
}
export type ViewKey = Partial<View> & { at: number; ease?: "spring" | "out" | "inout" | "cut"; dur?: number };

export type TypeStyle = "caption" | "label" | "title";
export interface TypeLayer {
  id: string;
  text: string;
  at: number;
  out?: number;
  style: TypeStyle;
  color: string;
  size: number;
  portSize?: number;
  portText?: string;
  box: Record<Aspect, Box>;
  align?: "left" | "center" | "right";
  portAlign?: "left" | "center" | "right";
}

export type Layout = "sidebar" | "right" | "top";
export type Who =
  | "priya" | "tomas" | "jun" | "ava" | "maya" | "leo" | "okafor" | "sam" | "kai" | "noor" | "ruiz" | "ana" | "ben" | "cleo";

export interface Pane {
  id: string;
  box: Record<Aspect, Box>;
  cam?: Record<Aspect, ViewKey[]>;
  scene?: string;
  who?: Who;
  layout?: Layout;
  role?: "rest" | "drag" | "arrive" | "add" | "edits";
  marks?: Record<string, number>;
}

export type ShotKind = "chat" | "turn" | "panes" | "share" | "files" | "callback" | "end";

export interface Shot {
  id: string;
  kind: ShotKind;
  at: number;
  beats: number;
  type: TypeLayer[];
  panes?: Pane[];
  marks?: Record<string, number>;
  tone?: "light" | "dark";
}

export const INK = "#1D1D1F";
export const MUTED = "#6E6E73";
export const LIGHT_BG = "#F5F5F7";
export const DARK_BG = "#0B0B0C";
export const PEOPLE: Record<Who, { name: string; color: string }> = {
  priya: { name: "Priya", color: "#B0617F" },
  tomas: { name: "Tomás", color: "#3F7DB0" },
  jun: { name: "Jun", color: "#2F8A5F" },
  ava: { name: "Ava", color: "#C8692F" },
  maya: { name: "Maya", color: "#6E62B0" },
  leo: { name: "Leo", color: "#B5484D" },
  okafor: { name: "Dr. Okafor", color: "#C2607A" },
  sam: { name: "Sam", color: "#B88A1E" },
  kai: { name: "Kai", color: "#C8692F" },
  noor: { name: "Noor", color: "#B88A1E" },
  ruiz: { name: "Ms. Ruiz", color: "#3F7DB0" },
  ana: { name: "Ana", color: "#2F8A5F" },
  ben: { name: "Ben", color: "#C2607A" },
  cleo: { name: "Cleo", color: "#7A7A80" },
};

const T = (id: string, text: string, at: number, out: number | undefined, style: TypeStyle, size: number, land: Box, port: Box, more: Partial<TypeLayer> = {}): TypeLayer =>
  ({ id, text, at, out, style, size, color: INK, box: { land, port }, align: "center", ...more });

const view = (box: Box, x0: number, y0: number, x1: number, y1: number): View => {
  const s = Math.min(box[2] / (x1 - x0), box[3] / (y1 - y0));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
};
type Key = [at: number, x0: number, y0: number, x1: number, y1: number, ease?: ViewKey["ease"], dur?: number];
const keys = (box: Box, list: Key[]): ViewKey[] => list.map(([at, x0, y0, x1, y1, ease, dur]) => ({ at, ...view(box, x0, y0, x1, y1), ease, dur }));
const pane = (id: string, box: Record<Aspect, Box>, land: Key[], port: Key[], more: Partial<Pane> = {}): Pane => ({
  id, box, cam: { land: keys(box.land, land), port: keys(box.port, port) }, ...more,
});
const region = (layout: Layout | undefined, w: number, h: number, y0 = 16): [number, number, number, number] =>
  layout === "right" ? [1280 - w, y0, 1280, y0 + h] : layout === "top" ? [0, 0, w + 300, h] : [0, y0, w, y0 + h];

const CAP: Record<Aspect, Box> = { land: [160, 930, 1600, 110], port: [60, 1500, 960, 220] };
const CAP_TOP: Record<Aspect, Box> = { land: [160, 30, 1600, 100], port: [60, 230, 960, 200] };
const cap = (id: string, text: string, at: number, out: number, more: Partial<TypeLayer> = {}) =>
  T(id, text, at, out, "caption", 62, CAP.land, CAP.port, { portSize: 64, ...more });
const capTop = (id: string, text: string, at: number, out: number, more: Partial<TypeLayer> = {}) =>
  T(id, text, at, out, "caption", 62, CAP_TOP.land, CAP_TOP.port, { portSize: 64, ...more });

const chat: Shot = {
  id: "chat", kind: "chat", at: 0, beats: 16,
  panes: [{ id: "chat-app", box: { land: [40, 30, 1840, 870], port: [30, 230, 1020, 1240] } }],
  marks: { scroll: 4, scrollEnd: 7, launch: 8, trip: 12 },
  type: [cap("chat-lost", "Links get lost in the chat.", 5, 15.8)],
};

const turn: Shot = {
  id: "turn", kind: "turn", at: 16, beats: 8,
  panes: [pane("turn-priya", { land: [300, 150, 1320, 825], port: [40, 450, 1000, 1000] },
    [[0, 0, 16, 600, 420], [4.6, 0, 0, 1000, 625, "inout", 3.2]], [[0, 0, 16, 440, 480], [4.6, 0, 0, 640, 700, "inout", 3.2]],
    { scene: "turn-share-priya", who: "priya", layout: "sidebar" })],
  marks: { lift: 0.3, land: 2.2, stagger: 0.4 },
  type: [capTop("turn-better", "There’s a better place for them.", 1, 7.8)],
};

const cell = (c: number, r: number): Record<Aspect, Box> => ({
  land: [70 + c * 898, 214 + r * 418, 880, 354],
  port: [30 + c * 519, 470 + r * 520, 501, 450],
});
const recv = (id: string, scene: string, who: Who, layout: Layout, c: number, r: number, role: Pane["role"], marks: Record<string, number>) => {
  const [x0, y0, x1, y1] = region(layout, 620, 282, 8);
  const [px0, py0, px1, py1] = region(layout, 420, 400, 8);
  return pane(id, cell(c, r), [[0, x0, y0, x1, y1], [0.01, x0, y0 + 2, x1 - 30, y1 - 12, "inout", 7.9]], [[0, px0, py0, px1, py1]], { scene, who, layout, role, marks });
};

const grid: Shot = {
  id: "grid", kind: "panes", at: 24, beats: 8,
  panes: [
    recv("grid-priya", "turn-share-priya", "priya", "sidebar", 0, 0, "rest", {}),
    recv("grid-tomas", "turn-add-tomas", "tomas", "sidebar", 1, 0, "add", { arrive: 0 }),
    recv("grid-jun", "turn-add-jun", "jun", "right", 0, 1, "add", { arrive: 0 }),
    recv("grid-ava", "turn-add-ava", "ava", "top", 1, 1, "add", { arrive: 0 }),
  ],
  type: [
    T("grid-title", "Shared Folders", 0.6, 7.9, "title", 84, [160, 22, 1600, 100], [60, 240, 960, 110]),
    T("grid-every", "One folder, in everyone’s sidebar.", 2.5, 7.9, "caption", 44, [160, 996, 1600, 64], [60, 1460, 960, 140], { color: MUTED, portSize: 50 }),
  ],
};

const share: Shot = {
  id: "share", kind: "share", at: 32, beats: 12,
  panes: [pane("share-window", { land: [300, 80, 1320, 825], port: [40, 420, 1000, 1000] },
    [[0, 0, 0, 1280, 800], [0.2, 0, 10, 860, 560, "inout", 1.6], [7.8, 0, 20, 520, 340, "inout", 1.8]],
    [[0, 0, 0, 800, 800], [0.2, 0, 10, 620, 600, "inout", 1.6], [7.8, 0, 20, 420, 420, "inout", 1.8]],
    { scene: "sf-share", who: "priya", layout: "sidebar" })],
  marks: { menu: 1.2, pick: 2.8, sheet: 3.4, tick: 5, choose: 6.8, glyph: 8.2 },
  type: [cap("share-apple", "Share it with anyone who has an Apple ID.", 3.4, 11.9)],
};

const files: Shot = {
  id: "files", kind: "files", at: 44, beats: 8,
  panes: [{ id: "files-card", box: { land: [560, 110, 800, 700], port: [90, 470, 900, 820] } }],
  type: [cap("files-icloud", "It lives in iCloud Drive. No new account.", 0.5, 7.9)],
};

const DUO_L: Record<Aspect, Box> = { land: [60, 140, 880, 740], port: [40, 300, 1000, 560] };
const DUO_R: Record<Aspect, Box> = { land: [980, 140, 880, 740], port: [40, 900, 1000, 560] };
const duoKeys = (layout: Layout, beats: number): [Key[], Key[]] => {
  const [x0, y0, x1, y1] = region(layout, 470, 400);
  const [px0, py0, px1, py1] = region(layout, 540, 300);
  return [[[0, x0, y0, x1, y1], [0.01, x0, y0 + 4, x1 - 20, y1 - 10, "inout", beats - 0.1]], [[0, px0, py0, px1, py1], [0.01, px0, py0 + 4, px1 - 20, py1 - 6, "inout", beats - 0.1]]];
};

const drop: Shot = {
  id: "drop", kind: "panes", at: 52, beats: 8,
  panes: [
    pane("drop-priya", DUO_L, ...duoKeys("sidebar", 8), { scene: "sf-drop", who: "priya", layout: "sidebar", role: "drag", marks: { grab: 1.8, up: 3.5 } }),
    pane("drop-tomas", DUO_R, ...duoKeys("sidebar", 8), { scene: "sf-watch-drop", who: "tomas", layout: "sidebar", role: "arrive", marks: { arrive: 5.6 } }),
  ],
  type: [cap("drop-add", "Add a link, and it’s there for everyone.", 0.5, 7.9)],
};

const edits: Shot = {
  id: "edits", kind: "panes", at: 60, beats: 12,
  panes: [
    pane("edits-priya", DUO_L, ...duoKeys("sidebar", 12), { who: "priya", layout: "sidebar", role: "edits", marks: { renameType: 1.2, renameCommit: 3.1, reorderArrive: 7.7, nest: 9.0 } }),
    pane("edits-tomas", DUO_R, ...duoKeys("sidebar", 12), { who: "tomas", layout: "sidebar", role: "edits", marks: { renameArrive: 4.2, reorderGrab: 5.4, reorderUp: 6.7, nestArrive: 10.1 } }),
  ],
  type: [
    cap("edits-rename", "Rename it.", 0.8, 5.2),
    cap("edits-reorder", "Reorder it.", 5.2, 8.8),
    cap("edits-nest", "Tuck it into a subfolder.", 8.8, 11.9),
  ],
};

const LABEL: Record<Aspect, Box> = { land: [90, 990, 1740, 70], port: [60, 1500, 960, 80] };
const vignette = (id: string, at: number, label: string, cause: Pane, effects: Pane[], causeBeats: number, beats: number): Shot[] => [
  { id: `${id}-cause`, kind: "panes", at, beats: causeBeats, tone: "dark", panes: [cause], type: [T(`${id}-label`, label, 0, causeBeats, "label", 46, LABEL.land, LABEL.port, { color: LIGHT_BG, align: "left" })] },
  { id: `${id}-effect`, kind: "panes", at: at + causeBeats, beats: beats - causeBeats, tone: "dark", panes: effects, type: [T(`${id}-label2`, label, 0, beats - causeBeats, "label", 46, LABEL.land, LABEL.port, { color: LIGHT_BG, align: "left" })] },
];
const WIDE: Record<Aspect, Box> = { land: [160, 110, 1600, 850], port: [40, 360, 1000, 1080] };
const causePane = (id: string, scene: string, who: Who, layout: Layout, grab: number, up: number, beats: number): Pane => {
  const [x0, y0, x1, y1] = region(layout, 660, 380);
  const [px0, py0, px1, py1] = region(layout, 420, 460);
  return pane(id, WIDE, [[0, x0, y0, x1, y1], [0.01, x0, y0 + 6, x1 - 30, y1 - 10, "inout", beats]], [[0, px0, py0, px1, py1], [0.01, px0, py0 + 6, px1 - 20, py1 - 10, "inout", beats]], { scene, who, layout, role: "drag", marks: { grab, up } });
};
const effectPane = (id: string, scene: string, who: Who, layout: Layout, box: Record<Aspect, Box>, arrive: number, small = false): Pane => {
  const [x0, y0, x1, y1] = small ? region(layout, layout === "top" ? 420 : 300, 290) : region(layout, 600, 360);
  const [px0, py0, px1, py1] = small ? region(layout, layout === "top" ? 520 : 400, 150) : region(layout, 460, 330);
  return pane(id, box, [[0, x0, y0, x1, y1], [arrive, x0, y0 + 4, x1 - 40, y1 - 20, "spring"]], [[0, px0, py0, px1, py1], [arrive, px0, py0 + 4, px1 - 30, py1 - 16, "spring"]], { scene, who, layout, role: "arrive", marks: { arrive } });
};
const TRI = (i: number): Record<Aspect, Box> => ({
  land: [40 + i * 620, 250, 600, 560],
  port: [40, 340 + i * 380, 1000, 360],
});

const montage: Shot[] = [
  ...vignette("v-thesis", 72, "A thesis reading list",
    causePane("v-thesis-jun", "turn-0-act-jun", "jun", "right", 0.3, 1.4, 2.5), [
      effectPane("v-thesis-priya", "turn-0-watch-priya", "priya", "sidebar", TRI(0), 0.5, true),
      effectPane("v-thesis-tomas", "turn-0-watch-tomas", "tomas", "sidebar", TRI(1), 0.5, true),
      effectPane("v-thesis-ava", "turn-0-watch-ava", "ava", "top", TRI(2), 0.5, true),
    ], 2.5, 5.5),
  ...vignette("v-launch", 77.5, "A product launch",
    causePane("v-launch-maya", "launch-0-act-maya", "maya", "sidebar", 0.2, 1.3, 2.5), [
      effectPane("v-launch-leo", "launch-0-watch-leo", "leo", "right", WIDE, 0.5),
    ], 2.5, 5.5),
  ...vignette("v-lab", 83, "A research lab",
    causePane("v-lab-okafor", "lab-0-act-okafor", "okafor", "sidebar", 0.2, 1.3, 2.5), [
      effectPane("v-lab-sam", "lab-0-watch-sam", "sam", "sidebar", WIDE, 0.5),
    ], 2.5, 6),
  ...vignette("v-trip", 89, "A weekend away",
    causePane("v-trip-kai", "trip-0-act-kai", "kai", "sidebar", 0.2, 1.3, 2.5), [
      effectPane("v-trip-noor", "trip-0-watch-noor", "noor", "top", WIDE, 0.5),
    ], 2.5, 5.5),
  ...vignette("v-class", 94.5, "A class",
    causePane("v-class-ruiz", "class-0-act-ruiz", "ruiz", "sidebar", 0.2, 1.3, 2.5), [
      effectPane("v-class-ana", "class-0-watch-ana", "ana", "right", TRI(0), 0.5, true),
      effectPane("v-class-ben", "class-0-watch-ben", "ben", "sidebar", TRI(1), 0.5, true),
      effectPane("v-class-cleo", "class-0-watch-cleo", "cleo", "top", TRI(2), 0.5, true),
    ], 2.5, 5.5),
];

const callback: Shot = {
  id: "callback", kind: "callback", at: 100, beats: 4,
  panes: [{ id: "callback-app", box: { land: [40, 30, 1840, 870], port: [30, 230, 1020, 1240] } }],
  type: [],
};

const end: Shot = {
  id: "end", kind: "end", at: 104, beats: 8,
  panes: [{ id: "end-icon", box: { land: [860, 200, 200, 200], port: [440, 520, 200, 200] } }],
  type: [
    T("end-feature", "Shared Folders", 0, 8, "title", 110, [160, 440, 1600, 130], [60, 760, 960, 130], { portSize: 96 }),
    T("end-ardia", "Ardia, the sidebar browser for Mac", 0, 8, "caption", 44, [160, 590, 1600, 70], [60, 920, 960, 140], { color: MUTED, portText: "Ardia, the sidebar\nbrowser for Mac", portSize: 46 }),
    T("end-url", "Download at ardia.dev", 0, 8, "caption", 52, [160, 710, 1600, 80], [60, 1090, 960, 90], { color: "#2150D9", portSize: 52 }),
  ],
};

const film: Shot[] = [chat, turn, grid, share, files, drop, edits, ...montage, callback, end];

export type CutName = "film";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  film: { beats: 112, shots: film },
};
