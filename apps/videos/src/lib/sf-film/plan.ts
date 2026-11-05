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
  cut?: boolean;
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

export type ShotKind = "chat" | "turn" | "panes" | "share" | "accept" | "files" | "callback" | "end";

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

const CAP: Record<Aspect, Box> = { land: [160, 930, 1600, 110], port: [60, 1365, 960, 110] };
const cap = (id: string, text: string, at: number, out: number, more: Partial<TypeLayer> = {}) =>
  T(id, text, at, out, "caption", 62, CAP.land, CAP.port, { portSize: 64, ...more });

export const chat: Shot = {
  id: "chat", kind: "chat", at: 0, beats: 16,
  panes: [{ id: "chat-app", box: { land: [40, 30, 1840, 870], port: [30, 190, 1020, 1140] } }],
  marks: { scroll: 3.5, scrollEnd: 7, launch: 9, back: 12.5, panel: 13.6 },
  type: [cap("chat-lost", "Links get lost.", 9.5, 13.5)],
};

const turn: Shot = {
  id: "turn", kind: "turn", at: 16, beats: 7,
  panes: [pane("turn-priya", { land: [300, 150, 1320, 825], port: [40, 250, 1000, 1080] },
    [[0, 0, 16, 600, 420], [3.6, 0, 6, 760, 500, "inout", 3.3]], [[0, 0, 16, 440, 480], [3.6, 0, 8, 520, 560, "inout", 3.3]],
    { scene: "story-share-priya", who: "priya", layout: "sidebar" })],
  marks: { lift: 0.5, land: 2.8, stagger: 0.22, chatOut: 0.8, rise: 1.65 },
  type: [],
};

const cell = (c: number, r: number): Record<Aspect, Box> => ({
  land: [70 + c * 898, 214 + r * 418, 880, 354],
  port: [40 + c * 510, 290 + r * 580, 490, 500],
});
const recv = (id: string, scene: string, who: Who, layout: Layout, c: number, r: number, role: Pane["role"], marks: Record<string, number>) => {
  const [x0, y0, x1, y1] = region(layout, layout === "top" ? 700 : 600, 300, 8);
  const [px0, py0, px1, py1] = layout === "top" ? [600, 0, 1160, 572] : region(layout, 270, 276, 8);
  const land: Key[] = layout === "top" ? [[0, x0, y0, x1, y1], [0.3, 0, 0, 1180, 475, "inout", 2.3]] : [[0, x0, y0, x1, y1], [0.01, x0, y0 + 2, x1 - 24, y1 - 10, "inout", 7.9]];
  const port: Key[] = [[0, px0, py0, px1, py1], [0.01, px0, py0 + 2, px1 - 8, py1 - 8, "inout", 7.9]];
  return pane(id, cell(c, r), land, port, { scene, who, layout, role, marks });
};

const grid: Shot = {
  id: "grid", kind: "panes", at: 23, beats: 8,
  panes: [
    recv("grid-priya", "story-share-priya", "priya", "sidebar", 0, 0, "rest", {}),
    recv("grid-tomas", "story-add-tomas", "tomas", "sidebar", 1, 0, "add", { arrive: 1 }),
    recv("grid-jun", "story-add-jun", "jun", "right", 0, 1, "add", { arrive: 1 }),
    recv("grid-ava", "story-add-ava", "ava", "top", 1, 1, "add", { arrive: 1 }),
  ],
  type: [
    T("grid-title", "Shared Folders", 1.5, 7.9, "title", 84, [160, 22, 1600, 100], [60, 1390, 960, 90]),
  ],
};

const share: Shot = {
  id: "share", kind: "share", at: 31, beats: 12,
  panes: [pane("share-window", { land: [300, 80, 1320, 825], port: [40, 250, 1000, 1080] },
    [[0, 0, 10, 900, 590], [0.01, 0, 10, 860, 560, "inout", 6], [7.4, 0, 16, 720, 470, "inout", 3.6]],
    [[0, 0, 10, 640, 620], [0.01, 0, 10, 620, 600, "inout", 6], [7.4, 0, 16, 540, 530, "inout", 3.6]],
    { scene: "story-share-priya", who: "priya", layout: "sidebar" })],
  marks: { menu: 1.5, pick: 3, sheet: 3.6, tick: 5.4, choose: 7, glyph: 8.4 },
  type: [cap("share-apple", "Invite any Apple ID.", 6.5, 10.5)],
};

const accept: Shot = {
  id: "accept", kind: "accept", at: 43, beats: 6,
  panes: [pane("accept-window", { land: [300, 80, 1320, 825], port: [40, 250, 1000, 1080] },
    [[0, 0, 4, 860, 549], [0.01, 0, 4, 830, 529, "inout", 5.9]], [[0, 0, 4, 640, 674], [0.01, 0, 4, 620, 652, "inout", 5.9]],
    { scene: "story-add-tomas", who: "tomas", layout: "sidebar" })],
  marks: { menu: 0.8, pick: 2.0, arrive: 2.7 },
  type: [],
};

const files: Shot = {
  id: "files", kind: "files", at: 49, beats: 7,
  panes: [{ id: "files-card", box: { land: [560, 100, 800, 640], port: [90, 400, 900, 820] } }],
  marks: { scene: 0 },
  type: [cap("files-icloud", "Just iCloud Drive. No new account.", 1.4, 6.6)],
};

const DUO_L: Record<Aspect, Box> = { land: [60, 140, 880, 740], port: [40, 250, 1000, 520] };
const DUO_R: Record<Aspect, Box> = { land: [980, 140, 880, 740], port: [40, 840, 1000, 490] };
const duoKeys = (layout: Layout, beats: number): [Key[], Key[]] => {
  const [x0, y0, x1, y1] = region(layout, 470, 400);
  const [px0, py0, px1, py1] = region(layout, 560, 400);
  return [[[0, x0, y0, x1, y1], [0.01, x0, y0 + 4, x1 - 16, y1 - 8, "inout", beats - 0.1]], [[0, px0, py0, px1, py1], [0.01, px0, py0 + 4, px1 - 16, py1 - 5, "inout", beats - 0.1]]];
};

const drop: Shot = {
  id: "drop", kind: "panes", at: 56, beats: 10,
  panes: [
    pane("drop-priya", DUO_L, ...duoKeys("sidebar", 10), { scene: "story-0-act-priya", who: "priya", layout: "sidebar", role: "drag", marks: { grab: 1.5, up: 3.2 } }),
    pane("drop-tomas", DUO_R, ...duoKeys("sidebar", 10), { scene: "story-0-watch-tomas", who: "tomas", layout: "sidebar", role: "arrive", marks: { arrive: 5.5 } }),
  ],
  type: [],
};

const edits: Shot = {
  id: "edits", kind: "panes", at: 66, beats: 16,
  panes: [
    pane("edits-priya", DUO_L, ...duoKeys("sidebar", 16), { who: "priya", layout: "sidebar", role: "edits", marks: { renameField: 0.8, renameType: 1.3, renameCommit: 3.3, reorderArrive: 12.5 } }),
    pane("edits-tomas", DUO_R, ...duoKeys("sidebar", 16), { who: "tomas", layout: "sidebar", role: "edits", marks: { renameArrive: 4.6, reorderGrab: 8.9, reorderUp: 10.2 } }),
  ],
  type: [cap("edits-live", "Live, both ways.", 13.2, 15.9)],
};

const vignette = (id: string, at: number, cause: Pane, effects: Pane[], causeBeats: number, beats: number): Shot[] => [
  { id: `${id}-cause`, kind: "panes", at, beats: causeBeats, tone: "dark", panes: [cause], type: [] },
  { id: `${id}-effect`, kind: "panes", at: at + causeBeats, beats: beats - causeBeats, tone: "dark", panes: effects, type: [] },
];
const WIDE: Record<Aspect, Box> = { land: [160, 120, 1600, 860], port: [40, 270, 1000, 1180] };
const causePane = (id: string, scene: string, who: Who, layout: Layout, grab: number, up: number, beats: number): Pane => {
  const [x0, y0, x1, y1] = region(layout, 640, 360);
  const [px0, py0, px1, py1] = region(layout, 400, 440);
  return pane(id, WIDE, [[0, x0, y0, x1, y1], [0.01, x0, y0 + 4, x1 - 20, y1 - 8, "inout", beats]], [[0, px0, py0, px1, py1], [0.01, px0, py0 + 4, px1 - 14, py1 - 8, "inout", beats]], { scene, who, layout, role: "drag", marks: { grab, up } });
};
const effectPane = (id: string, scene: string, who: Who, layout: Layout, box: Record<Aspect, Box>, arrive: number, beats: number, small = false): Pane => {
  const top = layout === "top";
  const [x0, y0, x1, y1] = top ? (small ? [0, 0, 560, 520] : [120, 0, 1160, 380]) : small ? region(layout, 262, 245) : region(layout, 560, 340);
  const [px0, py0, px1, py1] = top ? (small ? [0, 0, 760, 230] : [520, 0, 1160, 755]) : small ? region(layout, 480, 170) : region(layout, 420, 460);
  return pane(id, box, [[0, x0, y0, x1, y1], [0.01, x0, y0, x1 - 16, y1 - 6, "inout", beats]], [[0, px0, py0, px1, py1], [0.01, px0, py0, px1 - 12, py1 - 6, "inout", beats]], { scene, who, layout, role: "arrive", marks: { arrive } });
};
const TRI = (i: number): Record<Aspect, Box> => ({
  land: [40 + i * 620, 250, 600, 560],
  port: [40, 270 + i * 400, 1000, 330],
});

const montage: Shot[] = [
  ...vignette("v-lab", 82,
    causePane("v-lab-okafor", "lab-0-act-okafor", "okafor", "sidebar", 0.1, 1.1, 2),
    [effectPane("v-lab-sam", "lab-0-watch-sam", "sam", "sidebar", WIDE, 0.7, 3)], 2, 5),
  ...vignette("v-trip", 87,
    causePane("v-trip-kai", "trip-0-act-kai", "kai", "sidebar", 0.1, 1.1, 2),
    [effectPane("v-trip-noor", "trip-0-watch-noor", "noor", "top", WIDE, 0.7, 3)], 2, 5),
  ...vignette("v-class", 92,
    causePane("v-class-ruiz", "class-0-act-ruiz", "ruiz", "sidebar", 0.1, 1.1, 2), [
      effectPane("v-class-ana", "class-0-watch-ana", "ana", "right", TRI(0), 0.7, 3, true),
      effectPane("v-class-ben", "class-0-watch-ben", "ben", "sidebar", TRI(1), 0.7, 3, true),
      effectPane("v-class-cleo", "class-0-watch-cleo", "cleo", "top", TRI(2), 0.7, 3, true),
    ], 2, 5),
];

const callback: Shot = {
  id: "callback", kind: "callback", at: 97, beats: 4,
  panes: [{ id: "callback-app", box: { land: [40, 30, 1840, 870], port: [30, 190, 1020, 1140] } }],
  type: [],
};

const end: Shot = {
  id: "end", kind: "end", at: 101, beats: 10,
  panes: [{ id: "end-icon", box: { land: [860, 170, 200, 200], port: [440, 520, 200, 200] } }],
  marks: { lockup: 4 },
  type: [
    T("end-feature", "Shared Folders", 0, 4, "title", 120, [160, 460, 1600, 140], [60, 820, 960, 140], { portSize: 104, cut: true }),
    T("end-ardia", "Ardia", 4, 10, "title", 116, [160, 400, 1600, 130], [60, 755, 960, 130], { portSize: 112, cut: true }),
    T("end-category", "The sidebar browser for Mac", 4, 10, "caption", 58, [160, 540, 1600, 84], [60, 895, 960, 84], { color: MUTED, portSize: 56, cut: true }),
    T("end-url", "Download at ardia.dev", 4, 10, "caption", 62, [160, 650, 1600, 90], [60, 1000, 960, 90], { color: "#2150D9", portSize: 60, cut: true }),
  ],
};

const film: Shot[] = [chat, turn, grid, share, accept, files, drop, edits, ...montage, callback, end];

export type CutName = "film";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  film: { beats: 111, shots: film },
};
