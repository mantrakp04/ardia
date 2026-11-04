export const BEAT = 15;
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

export type TypeStyle = "slam" | "stamp" | "label";
export interface TypeLayer {
  id: string;
  text: string;
  at: number;
  out?: number;
  style: TypeStyle;
  color: string;
  fill?: string;
  size: number;
  portSize?: number;
  portText?: string;
  rotation?: number;
  box: Record<Aspect, Box>;
  align?: "left" | "center" | "right";
  portAlign?: "left" | "center" | "right";
  count?: [beat: number, n: number][];
}

export interface ScreenLayer {
  id: string;
  box: Record<Aspect, Box>;
  cam?: Record<Aspect, ViewKey[]>;
}

export type ShotKind =
  | "chat" | "folder" | "share" | "invite" | "accept" | "duo" | "cause" | "effect" | "same" | "words" | "nos" | "end";

export interface Shot {
  id: string;
  kind: ShotKind;
  at: number;
  beats: number;
  type: TypeLayer[];
  screens?: ScreenLayer[];
  marks?: Record<string, number>;
  scene?: string;
  who?: "priya" | "tomas";
}

const ink = "#16130F";
const paper = "#F1ECE2";
export const PEOPLE = {
  priya: { name: "Priya’s Mac", color: "#B0617F" },
  tomas: { name: "Tomás’s Mac", color: "#3F7DB0" },
} as const;
const P = { red: "#C3371F", blue: "#2150D9", priya: PEOPLE.priya.color, tomas: PEOPLE.tomas.color };

const T = (
  id: string, text: string, at: number, style: TypeStyle, size: number, land: Box, port: Box,
  more: Partial<TypeLayer> = {},
): TypeLayer => ({ id, text, at, style, size, color: ink, box: { land, port }, ...more });

const view = (box: Box, x0: number, y0: number, x1: number, y1: number): View => {
  const s = Math.min(box[2] / (x1 - x0), box[3] / (y1 - y0));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
};
type Key = [at: number, x0: number, y0: number, x1: number, y1: number, ease?: ViewKey["ease"], dur?: number];
const keys = (box: Box, list: Key[]): ViewKey[] => list.map(([at, x0, y0, x1, y1, ease, dur]) => ({ at, ...view(box, x0, y0, x1, y1), ease, dur }));

const FULL: Record<Aspect, Box> = { land: [270, 180, 1380, 862], port: [40, 500, 1000, 950] };
const CLOSE: Record<Aspect, Box> = { land: [80, 80, 1760, 930], port: [40, 420, 1000, 1040] };
const DUO_A: Record<Aspect, Box> = { land: [50, 215, 900, 830], port: [40, 420, 1000, 500] };
const DUO_B: Record<Aspect, Box> = { land: [970, 215, 900, 830], port: [40, 990, 1000, 480] };
const TOP: Record<Aspect, Box> = { land: [80, 26, 1760, 130], port: [60, 225, 960, 120] };
const WORD: Record<Aspect, Box> = { land: [1020, 770, 820, 210], port: [60, 225, 960, 125] };

const screen = (id: string, box: Record<Aspect, Box>, land: Key[], port: Key[]): ScreenLayer => ({
  id, box, cam: { land: keys(box.land, land), port: keys(box.port, port) },
});

const chat: Shot = {
  id: "chat", kind: "chat", at: 0, beats: 4,
  screens: [{ id: "chat-window", box: { land: [60, 60, 1060, 960], port: [40, 520, 1000, 940] } }],
  marks: { push: 3.2 },
  type: [
    T("chat-count", "46 LINKS.", 0, "slam", 300, [1180, 330, 700, 330], [60, 225, 960, 270], {
      out: 2, color: P.red, align: "center", portSize: 240, count: [[0, 46], [1, 47]],
    }),
    T("chat-not", "THE GROUP CHAT\nIS NOT\nA FOLDER.", 2, "slam", 200, [1180, 160, 690, 720], [60, 225, 960, 270], {
      portText: "THE GROUP CHAT\nIS NOT A FOLDER.", portSize: 120,
    }),
  ],
};

const folder: Shot = {
  id: "folder", kind: "folder", at: 4, beats: 4, scene: "sf-share", who: "priya",
  screens: [screen("folder-window", FULL, [[0, 0, 220, 420, 480], [0.15, 0, 10, 860, 560, "inout", 1.1]], [[0, 0, 220, 360, 560], [0.15, 0, 10, 620, 600, "inout", 1.1]])],
  type: [T("folder-share", "SHARE A FOLDER\nFROM YOUR SIDEBAR.", 0.5, "slam", 110, TOP.land, TOP.port, { color: paper, fill: ink, align: "center" })],
};

const share: Shot = {
  id: "share", kind: "share", at: 8, beats: 4, scene: "sf-share", who: "priya",
  screens: [screen("share-window", FULL, [[0, 0, 10, 860, 560], [0.01, 0, 20, 760, 495, "inout", 0.8], [2.9, 0, 20, 420, 280, "inout", 0.9]], [[0, 0, 10, 620, 600], [0.01, 0, 20, 620, 600, "inout", 0.8], [2.9, 0, 20, 360, 370, "inout", 0.9]])],
  type: [
    T("share-name", "SHARED FOLDERS.", 0, "slam", 120, [1000, 30, 860, 130], [60, 225, 960, 110], { color: paper, fill: P.priya, align: "center" }),
    T("share-invite", "INVITE ANY\nAPPLE ID.", 1.75, "slam", 150, [1300, 720, 560, 280], [60, 345, 960, 90], { color: paper, fill: P.red, portText: "INVITE ANY APPLE ID.", portSize: 80 }),
  ],
};

const invite: Shot = {
  id: "invite", kind: "invite", at: 12, beats: 2, scene: "sf-add", who: "tomas",
  screens: [screen("invite-window", FULL, [[0, 420, 0, 1280, 540], [0.01, 600, 0, 1280, 430, "inout", 1.9]], [[0, 700, 0, 1280, 560], [0.01, 820, 0, 1280, 460, "inout", 1.9]])],
  marks: { banner: 0.25, click: 1 },
  type: [],
};

const accept: Shot = {
  id: "accept", kind: "accept", at: 14, beats: 5, scene: "sf-add", who: "tomas",
  screens: [screen("accept-window", FULL, [[0, 0, 0, 1280, 800], [0.1, 0, 40, 700, 650, "inout", 0.8], [2.3, 0, 20, 700, 460, "inout", 0.8], [3.2, 0, 26, 640, 430, "inout", 1.8]], [[0, 0, 0, 800, 800], [0.1, 0, 40, 560, 650, "inout", 0.8], [2.3, 0, 20, 520, 540, "inout", 0.8], [3.2, 0, 26, 480, 520, "inout", 1.8]])],
  marks: { menu: 1, pick: 2, arrive: 2.5 },
  type: [T("accept-his", "NOW IT’S\nHIS TOO.", 2.5, "slam", 170, [1220, 760, 640, 260], [60, 225, 960, 200], { color: paper, fill: P.tomas, portText: "NOW IT’S HIS TOO." })],
};

const duo: Shot = {
  id: "duo", kind: "duo", at: 19, beats: 8, scene: "sf-drop",
  screens: [
    screen("duo-priya", DUO_A, [[0, 0, 30, 430, 430], [1.5, 0, 40, 400, 410, "inout", 2]], [[0, 0, 30, 500, 280], [1.5, 0, 30, 480, 270, "inout", 2]]),
    screen("duo-tomas", DUO_B, [[0, 0, 30, 430, 430], [0.01, 0, 36, 400, 400, "inout", 4.9], [5, 0, 40, 360, 380, "spring"]], [[0, 0, 30, 500, 280], [0.01, 0, 32, 480, 270, "inout", 4.9], [5, 0, 36, 440, 250, "spring"]]),
  ],
  marks: { grab: 1.5, up: 3.2, arrive: 5 },
  type: [
    T("duo-here", "DROP IT HERE.", 1.25, "slam", 120, [50, 30, 900, 120], [60, 225, 960, 120], { out: 5, color: paper, fill: P.priya, align: "center" }),
    T("duo-there", "IT LANDS THERE.", 5, "slam", 120, [970, 30, 900, 120], [60, 225, 960, 120], { color: paper, fill: P.tomas, align: "center" }),
  ],
};

const closeKeys: Key[] = [[0, 0, 20, 720, 420], [0.01, 0, 26, 690, 410, "inout", 2.4]];
const closePort: Key[] = [[0, 0, 20, 400, 450], [0.01, 0, 26, 380, 440, "inout", 2.4]];
const cause = (id: string, sceneName: string, who: "priya" | "tomas", at: number, beats: number, marks: Record<string, number>): Shot => ({
  id, kind: "cause", at, beats, scene: sceneName, who, marks, type: [],
  screens: [screen(`${id}-window`, CLOSE, closeKeys, closePort)],
});
const effect = (id: string, sceneName: string, who: "priya" | "tomas", at: number, beats: number, arrive: number): Shot => ({
  id, kind: "effect", at, beats, scene: sceneName, who, marks: { arrive }, type: [],
  screens: [screen(`${id}-window`, CLOSE, [[0, 0, 20, 720, 420], [arrive, 0, 26, 640, 400, "spring"]], [[0, 0, 20, 400, 450], [arrive, 0, 26, 370, 430, "spring"]])],
});
const words = (id: string, text: string, at: number, beats: number, fill: string): Shot => ({
  id, kind: "words", at, beats,
  type: [T(`${id}-text`, text, 0, "slam", 200, WORD.land, WORD.port, { color: paper, fill, portSize: 120, align: "center" })],
});

const backCause = cause("back-cause", "sf-back", "tomas", 27, 2.25, { grab: 0, up: 1.2 });
const backEffect = effect("back-effect", "sf-watch-back", "priya", 29.25, 1.75, 0.75);
const renameCause = cause("rename-cause", "sf-rename", "priya", 31, 2.25, { type: 0.25, commit: 2 });
const renameEffect = effect("rename-effect", "sf-watch-rename", "tomas", 33.25, 2.25, 0.75);
const reorderCause = cause("reorder-cause", "sf-reorder", "tomas", 35.5, 1.75, { grab: 0, up: 0.95 });
const reorderEffect = effect("reorder-effect", "sf-watch-reorder", "priya", 37.25, 1.75, 0.75);
const subCause = cause("sub-cause", "sf-sub", "priya", 39, 1, { nest: 0.1 });
const subEffect = effect("sub-effect", "sf-watch-sub", "tomas", 40, 2, 0.5);

const same: Shot = {
  id: "same", kind: "same", at: 42, beats: 2,
  screens: [
    screen("same-priya", DUO_A, [[0, 0, 30, 470, 470], [0.01, 0, 24, 520, 500, "inout", 1.9]], [[0, 0, 30, 560, 310], [0.01, 0, 24, 600, 330, "inout", 1.9]]),
    screen("same-tomas", DUO_B, [[0, 0, 30, 470, 470], [0.01, 0, 24, 520, 500, "inout", 1.9]], [[0, 0, 30, 560, 310], [0.01, 0, 24, 600, 330, "inout", 1.9]]),
  ],
  type: [T("same-line", "SAME FOLDER.\nEVERY SIDEBAR.", 0.5, "slam", 110, [80, 34, 1760, 120], [60, 225, 960, 120], { align: "center" })],
};

const BIG: Box = [80, 330, 1760, 420];
const BIG_PORT: Box = [60, 560, 960, 640];
const nos: Shot = {
  id: "nos", kind: "nos", at: 44, beats: 8,
  screens: [
    screen("nos-priya", DUO_A, [[0, 0, 24, 520, 500], [0.01, 0, 20, 560, 520, "inout", 4]], [[0, 0, 24, 600, 330], [0.01, 0, 20, 640, 350, "inout", 4]]),
    screen("nos-tomas", DUO_B, [[0, 0, 24, 520, 500], [0.01, 0, 20, 560, 520, "inout", 4]], [[0, 0, 24, 600, 330], [0.01, 0, 20, 640, 350, "inout", 4]]),
    { id: "nos-folder", box: { land: [1140, 170, 700, 600], port: [90, 900, 900, 560] } },
  ],
  type: [
    T("nos-account", "NO ARDIA\nACCOUNT.", 0, "slam", 260, BIG, BIG_PORT, { out: 2, color: paper, fill: ink, align: "center", portSize: 190 }),
    T("nos-server", "NO SERVER.", 2, "slam", 300, BIG, BIG_PORT, { out: 4, color: paper, fill: P.red, align: "center", portText: "NO\nSERVER.", portSize: 210 }),
    T("nos-icloud", "JUST\nICLOUD\nDRIVE.", 4, "slam", 230, [80, 150, 1000, 640], [60, 260, 900, 560], { color: ink, portText: "JUST\nICLOUD DRIVE.", portSize: 150 }),
    T("nos-path", "ICLOUD DRIVE › ARDIA SHARED › THESIS READING", 4.5, "label", 30, [84, 880, 1000, 50], [64, 820, 880, 80], { color: "#57524A", portSize: 28, portText: "ICLOUD DRIVE › ARDIA SHARED ›\nTHESIS READING" }),
  ],
};

const end: Shot = {
  id: "end", kind: "end", at: 52, beats: 12,
  screens: [
    { id: "end-icon", box: { land: [100, 210, 230, 230], port: [80, 260, 200, 200] } },
    screen("end-live", { land: [1240, 140, 600, 800], port: [80, 1010, 920, 460] }, [[0, 0, 26, 300, 426]], [[0, 0, 26, 520, 286]]),
  ],
  marks: { first: 0.5, second: 4, third: 7.5 },
  type: [
    T("end-new", "NEW: SHARED FOLDERS", 0, "slam", 54, [104, 140, 1060, 60], [84, 225, 920, 50], { color: P.priya, portSize: 34 }),
    T("end-name", "ARDIA", 0, "slam", 270, [360, 200, 760, 250], [310, 260, 690, 200], { portSize: 200 }),
    T("end-mac", "THE SIDEBAR BROWSER FOR MAC", 0, "slam", 64, [104, 480, 1060, 80], [84, 500, 900, 130], { color: P.blue, portText: "THE SIDEBAR\nBROWSER FOR MAC" }),
    T("end-download", "DOWNLOAD", 0, "slam", 86, [104, 610, 1060, 100], [84, 660, 880, 90]),
    T("end-url", "ARDIA.DEV", 0, "slam", 220, [100, 710, 1060, 240], [80, 760, 860, 200], { color: P.red, portSize: 170 }),
  ],
};

const film: Shot[] = [
  chat, folder, share, invite, accept, duo, backCause, backEffect, renameCause, renameEffect, reorderCause, reorderEffect,
  subCause, subEffect, same, nos, end,
  words("back-word", "BOTH WAYS.", 27, 4, ink),
  words("rename-word", "RENAMES.", 34, 2, P.tomas),
  words("reorder-word", "REORDERS.", 38, 2, P.priya),
  words("sub-word", "SUBFOLDERS.", 40.5, 2, P.tomas),
];

export type CutName = "film";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  film: { beats: 64, shots: film },
};
