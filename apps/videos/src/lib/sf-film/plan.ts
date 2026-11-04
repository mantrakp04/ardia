export const BEAT = 15;
export const f = (beat: number) => Math.round(beat * BEAT);
export const WIN_PT: readonly [number, number] = [1280, 800];

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
}

export interface ScreenLayer {
  id: string;
  box: Record<Aspect, Box>;
  cam?: Record<Aspect, ViewKey[]>;
}

export type ShotKind =
  | "chat" | "folder" | "share" | "accept" | "duo" | "cause" | "effect" | "same" | "nos" | "end";

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
const keys = (box: Box, list: [at: number, x0: number, y0: number, x1: number, y1: number, ease?: ViewKey["ease"], dur?: number][]): ViewKey[] =>
  list.map(([at, x0, y0, x1, y1, ease, dur]) => ({ at, ...view(box, x0, y0, x1, y1), ease, dur }));

const FULL: Record<Aspect, Box> = { land: [270, 170, 1380, 862], port: [40, 440, 1000, 1000] };
const CLOSE: Record<Aspect, Box> = { land: [80, 70, 1760, 940], port: [40, 360, 1000, 1080] };
const DUO_A: Record<Aspect, Box> = { land: [50, 190, 900, 840], port: [40, 360, 1000, 520] };
const DUO_B: Record<Aspect, Box> = { land: [970, 190, 900, 840], port: [40, 950, 1000, 520] };
const TOP: Record<Aspect, Box> = { land: [80, 26, 1760, 130], port: [60, 225, 960, 120] };
const RIGHT_PLATE: Record<Aspect, Box> = { land: [1020, 760, 820, 220], port: [60, 225, 960, 125] };

const screen = (id: string, box: Record<Aspect, Box>, land: Parameters<typeof keys>[1], port: Parameters<typeof keys>[1]): ScreenLayer => ({
  id, box, cam: { land: keys(box.land, land), port: keys(box.port, port) },
});

const chat: Shot = {
  id: "chat", kind: "chat", at: 0, beats: 8,
  screens: [{ id: "chat-window", box: { land: [110, 90, 1000, 900], port: [40, 560, 1000, 900] } }],
  type: [
    T("chat-not", "THE GROUP CHAT\nIS NOT\nA FOLDER.", 4, "slam", 200, [1170, 160, 690, 720], [60, 225, 960, 300], { portText: "THE GROUP CHAT\nIS NOT A FOLDER.", portSize: 130 }),
  ],
};

const folder: Shot = {
  id: "folder", kind: "folder", at: 8, beats: 4, scene: "sf-share", who: "priya",
  screens: [screen("folder-window", FULL, [[0, 0, 0, 1280, 800], [1, 0, 0, 1280, 800], [1.6, 0, 10, 860, 560, "inout", 1.6]], [[0, 0, 0, 800, 800], [1.6, 0, 10, 600, 600, "inout", 1.6]])],
  type: [T("folder-share", "SHARE A FOLDER\nFROM YOUR SIDEBAR.", 0.5, "slam", 110, TOP.land, TOP.port, { color: paper, fill: ink, portText: "SHARE A FOLDER\nFROM YOUR SIDEBAR.", align: "center" })],
};

const share: Shot = {
  id: "share", kind: "share", at: 12, beats: 4, scene: "sf-share", who: "priya",
  screens: [screen("share-window", FULL, [[0, 0, 10, 860, 560], [0.01, 0, 20, 760, 495, "inout", 0.8], [2.9, 0, 20, 420, 280, "inout", 0.9]], [[0, 0, 10, 600, 600], [0.01, 0, 20, 600, 600, "inout", 0.8], [2.9, 0, 20, 360, 370, "inout", 0.9]])],
  type: [
    T("share-name", "SHARED FOLDERS", 0, "label", 44, [1010, 40, 860, 60], [60, 232, 960, 56], { color: P.priya, align: "right", portAlign: "left" }),
    T("share-invite", "INVITE ANY\nAPPLE ID.", 1.75, "slam", 150, [1300, 700, 560, 300], [60, 300, 960, 120], { color: paper, fill: P.red, portText: "INVITE ANY APPLE ID.", portSize: 90 }),
  ],
};

const accept: Shot = {
  id: "accept", kind: "accept", at: 16, beats: 4, scene: "sf-add", who: "tomas",
  screens: [screen("accept-window", FULL, [[0, 0, 0, 1280, 800], [0.2, 0, 0, 1100, 730, "inout", 0.8], [2.3, 0, 20, 700, 460, "inout", 0.8]], [[0, 0, 0, 800, 800], [0.2, 0, 0, 720, 720, "inout", 0.8], [2.3, 0, 20, 520, 540, "inout", 0.8]])],
  type: [T("accept-his", "NOW IT’S\nHIS TOO.", 2.5, "slam", 170, [1180, 700, 680, 320], [60, 225, 960, 200], { color: paper, fill: P.tomas, portText: "NOW IT’S HIS TOO." })],
};

const duo: Shot = {
  id: "duo", kind: "duo", at: 20, beats: 7, scene: "sf-drop",
  screens: [
    screen("duo-priya", DUO_A, [[0, 0, 30, 430, 430], [1, 0, 40, 400, 410, "inout", 2]], [[0, 0, 30, 500, 330], [1, 0, 30, 480, 320, "inout", 2]]),
    screen("duo-tomas", DUO_B, [[0, 0, 30, 430, 430], [4, 0, 40, 360, 380, "spring"]], [[0, 0, 30, 500, 330], [4, 0, 36, 440, 300, "spring"]]),
  ],
  marks: { grab: 1, up: 3, arrive: 4 },
  type: [
    T("duo-here", "DROP IT HERE.", 0.5, "slam", 120, [50, 40, 900, 120], [60, 225, 960, 120], { out: 4, color: paper, fill: P.priya, align: "center" }),
    T("duo-there", "IT LANDS THERE.", 4, "slam", 120, [970, 40, 900, 120], [60, 225, 960, 120], { color: paper, fill: P.tomas, align: "center" }),
  ],
};

const closeKeys = (from: number): Parameters<typeof keys>[1] => [[0, 0, 20, 720, 420], [from, 0, 26, 690, 410, "inout", 2.5]];
const closePort = (from: number): Parameters<typeof keys>[1] => [[0, 0, 20, 400, 450], [from, 0, 26, 380, 440, "inout", 2.5]];
const cause = (id: string, sceneName: string, who: "priya" | "tomas", at: number, beats: number, marks: Record<string, number>, type: TypeLayer[] = []): Shot => ({
  id, kind: "cause", at, beats, scene: sceneName, who, marks, type,
  screens: [screen(`${id}-window`, CLOSE, closeKeys(0), closePort(0))],
});
const effect = (id: string, sceneName: string, who: "priya" | "tomas", at: number, beats: number, arrive: number, type: TypeLayer[]): Shot => ({
  id, kind: "effect", at, beats, scene: sceneName, who, marks: { arrive }, type,
  screens: [screen(`${id}-window`, CLOSE, [[0, 0, 20, 720, 420], [arrive, 0, 26, 640, 400, "spring"]], [[0, 0, 20, 400, 450], [arrive, 0, 26, 370, 430, "spring"]])],
});
const WORD = (id: string, text: string, at: number, fill: string): TypeLayer =>
  T(id, text, at, "slam", 200, RIGHT_PLATE.land, RIGHT_PLATE.port, { color: paper, fill, portSize: 120, align: "center" });

const backCause = cause("back-cause", "sf-back", "tomas", 27, 2.5, { grab: 0, up: 2 }, [
  T("back-both", "BOTH WAYS.", 0, "slam", 200, RIGHT_PLATE.land, RIGHT_PLATE.port, { color: paper, fill: ink, portSize: 120, align: "center" }),
]);
const backEffect = effect("back-effect", "sf-watch-back", "priya", 29.5, 1.5, 0.5, []);
const renameCause = cause("rename-cause", "sf-rename", "priya", 31, 2.5, { type: 0.25, commit: 2 });
const renameEffect = effect("rename-effect", "sf-watch-rename", "tomas", 33.5, 1.5, 0.5, [WORD("rename-word", "RENAMES.", 0.5, P.tomas)]);
const reorderCause = cause("reorder-cause", "sf-reorder", "tomas", 35, 1.75, { grab: 0, up: 1.5 });
const reorderEffect = effect("reorder-effect", "sf-watch-reorder", "priya", 36.75, 1.75, 0.25, [WORD("reorder-word", "REORDERS.", 0.25, P.priya)]);
const subCause = cause("sub-cause", "sf-sub", "priya", 38.5, 0.75, { nest: 0 });
const subEffect = effect("sub-effect", "sf-watch-sub", "tomas", 39.25, 1.25, 0.25, [WORD("sub-word", "SUBFOLDERS.", 0.25, P.tomas)]);

const same: Shot = {
  id: "same", kind: "same", at: 40.5, beats: 3.5,
  screens: [
    screen("same-priya", DUO_A, [[0, 0, 30, 460, 460], [0.01, 0, 20, 520, 500, "inout", 3.4]], [[0, 0, 40, 520, 320], [0.01, 0, 30, 560, 350, "inout", 3.4]]),
    screen("same-tomas", DUO_B, [[0, 0, 30, 460, 460], [0.01, 0, 20, 520, 500, "inout", 3.4]], [[0, 0, 40, 520, 320], [0.01, 0, 30, 560, 350, "inout", 3.4]]),
  ],
  type: [T("same-line", "SAME FOLDER.\nEVERY SIDEBAR.", 0.25, "slam", 110, [80, 34, 1760, 120], [60, 225, 960, 120], { color: ink, align: "center", portText: "SAME FOLDER.\nEVERY SIDEBAR." })],
};

const BIG: Box = [80, 230, 1760, 560];
const BIG_PORT: Box = [60, 420, 960, 760];
const nos: Shot = {
  id: "nos", kind: "nos", at: 44, beats: 8,
  screens: [{ id: "nos-folder", box: { land: [1140, 150, 700, 700], port: [90, 900, 900, 560] } }],
  type: [
    T("nos-account", "NO ACCOUNT.", 0, "slam", 400, BIG, BIG_PORT, { out: 2, color: paper, align: "center", portText: "NO\nACCOUNT." }),
    T("nos-signup", "NO SIGN-UP.", 2, "slam", 400, BIG, BIG_PORT, { out: 4, color: paper, align: "center", portText: "NO\nSIGN-UP." }),
    T("nos-icloud", "JUST\nICLOUD\nDRIVE.", 4, "slam", 230, [80, 150, 1000, 640], [60, 260, 960, 560], { color: ink, portText: "JUST\nICLOUD DRIVE." }),
    T("nos-path", "ICLOUD DRIVE › ARDIA SHARED › THESIS READING", 4.5, "label", 30, [84, 880, 1800, 50], [64, 820, 960, 80], { color: "#57524A", portSize: 28, portText: "ICLOUD DRIVE › ARDIA SHARED ›\nTHESIS READING" }),
  ],
};

const end: Shot = {
  id: "end", kind: "end", at: 52, beats: 12, marks: { lockup: 0 },
  screens: [{ id: "end-icon", box: { land: [470, 170, 250, 250], port: [100, 330, 220, 220] } }],
  type: [
    T("end-name", "ARDIA", 0, "slam", 290, [760, 160, 720, 270], [360, 330, 660, 220], { portSize: 220 }),
    T("end-mac", "THE SIDEBAR BROWSER FOR MAC", 0, "slam", 70, [300, 480, 1320, 90], [100, 620, 880, 150], { color: P.blue, align: "center", portAlign: "left", portText: "THE SIDEBAR\nBROWSER FOR MAC" }),
    T("end-download", "DOWNLOAD", 0, "slam", 90, [300, 620, 1320, 100], [100, 850, 880, 100], { align: "center", portAlign: "left" }),
    T("end-url", "ARDIA.DEV", 0, "slam", 230, [300, 730, 1320, 250], [100, 960, 880, 200], { color: P.red, align: "center", portAlign: "left" }),
  ],
};

const film: Shot[] = [chat, folder, share, accept, duo, backCause, backEffect, renameCause, renameEffect, reorderCause, reorderEffect, subCause, subEffect, same, nos, end];

export type CutName = "film";
export const CUTS: Record<CutName, { beats: number; shots: Shot[] }> = {
  film: { beats: 64, shots: film },
};
