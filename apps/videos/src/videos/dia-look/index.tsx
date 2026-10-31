import type { CSSProperties } from "react";
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";

loadFonts();

type Column = "before" | "after" | "dia";

interface Still {
  file: string;
  x: number;
  y: number;
  fill?: string;
  note?: string;
}

interface Gap {
  gap: "not-captured" | "no-equivalent";
}

interface State {
  label: string;
  file: string;
  x: number;
  y: number;
  dia: Still | Gap;
}

interface Scene {
  group: string;
  title: string;
  body: string;
  layout: "cols" | "rows";
  w: number;
  h: number;
  states: State[];
}

const FPS = 30;
const INTRO = Math.round(3.2 * FPS);
const OUTRO = Math.round(3.4 * FPS);
const STATE = 36;
const LEAD = 10;
const TAIL = 16;
const FADE = 8;
const SCENE_FADE = 8;
const MARGIN = 60;
const COL_GAP = 40;
const COL_BOX = { w: Math.floor((1920 - 2 * MARGIN - 2 * COL_GAP) / 3), h: 590 };
const COL_TOP = 360;
const ROW_BOX = { w: 1500, h: 200 };
const ROW_TOP = 290;
const ROW_GAP = 34;
const ROW_LEFT = 360;
const PILL_TOP = 1002;
const VERSIONS: Record<Column, string> = { before: "0.2.43-nightly.5 · glass", after: "main · flat", dia: "Dia 1.55.1" };
const NOT_CAPTURED: Gap = { gap: "not-captured" };
const NO_EQUIVALENT: Gap = { gap: "no-equivalent" };

const s = (label: string, file: string, x: number, y: number, dia: Still | Gap = NOT_CAPTURED): State => ({ label, file, x, y, dia });
const d = (file: string, x: number, y: number, extra: Partial<Still> = {}): Still => ({ file, x, y, ...extra });
const isGap = (v: Still | Gap): v is Gap => "gap" in v;

const ONB_TILE = [222, 300] as const;
const ONB_ROWS = [222, 306] as const;
const ONB_BUTTONS = [222, 608] as const;
const TILES = [0, 45] as const;
const ROWS = [0, 108] as const;
const CARD = [186, 140] as const;
const TOOLBAR = [196, 10] as const;
const COMMAND = [308, 56] as const;
const DOWNLOADS = [10, 50] as const;
const SITEINFO = [966, 50] as const;
const PEEK = [1010, 44] as const;
const FIELD = [400, 292] as const;
const ASK = [192, 46] as const;
const ASK_BUTTONS = [205, 138] as const;
const CHECKIN = [192, 46] as const;
const POSTCARD = [975, 8] as const;
const PERSONALIZE = [896, 444] as const;
const PIP = [0, 0] as const;
const DIA_DARK = "#282121";
const DIA_LIGHT = "#FCF8F9";

const SCENES: Scene[] = [
  {
    group: "Onboarding",
    title: "Intro controls",
    body: "The Skip and sound pills on the intro were glass. Dia's intro has the same two controls.",
    layout: "cols",
    w: 160,
    h: 64,
    states: [
      s("Dark · Skip", "01-onboarding-intro-rest", 1110, 722, d("01-onboarding-intro-skip-dia", 69, 65, { note: "Dia 1.55.1 · Skip Intro" })),
      s("Dark · sound", "01-onboarding-intro-rest", 14, 722, d("01-onboarding-intro-sound-dia", 13, 63, { note: "Dia 1.55.1 · sound" })),
      s("Light · Skip", "01-onboarding-intro-rest-light", 1110, 722),
    ],
  },
  {
    group: "Onboarding",
    title: "Choosing a browser",
    body: "“Where are you coming from?” The tiles drop the glass plate. Dia's onboarding stops at sign-in, so it has nothing to compare here.",
    layout: "cols",
    w: 196,
    h: 84,
    states: [
      s("Dark · rest", "02-onboarding-source-1-source-rest", ...ONB_TILE),
      s("Dark · pointer on Arc", "02-onboarding-source-1-source-tile-arc-hover", ...ONB_TILE),
      s("Dark · Arc pressed", "02-onboarding-source-1-source-tile-arc-pressed", ...ONB_TILE),
      s("Dark · Arc selected", "02-onboarding-source-1-source-selected-arc", ...ONB_TILE),
      s("Light · Arc selected", "02-onboarding-source-1-source-selected-arc-light", ...ONB_TILE),
    ],
  },
  {
    group: "Onboarding",
    title: "Choice rows",
    body: "“Where do your tabs go?” Rows are a flat fill with a hairline, and the chosen one keeps its ring.",
    layout: "cols",
    w: 384,
    h: 134,
    states: [
      s("Dark · rest", "03-onboarding-layout-1-tabs-rest", ...ONB_ROWS),
      s("Dark · pointer on “Along the top”", "03-onboarding-layout-1-tabs-tile-along-the-top-hover", ...ONB_ROWS),
      s("Dark · pressed", "03-onboarding-layout-1-tabs-tile-along-the-top-pressed", ...ONB_ROWS),
      s("Light · rest", "03-onboarding-layout-1-tabs-rest-light", ...ONB_ROWS),
    ],
  },
  {
    group: "Onboarding",
    title: "Back, Continue, Skip",
    body: "The button row under every question. Dia's nearest is the Let's go button on its sign-in screen, at rest and disabled.",
    layout: "cols",
    w: 232,
    h: 52,
    states: [
      s("Dark · rest", "03-onboarding-layout-1-tabs-rest", ...ONB_BUTTONS, d("02-onboarding-account-rest-dia", 300, 190, { fill: "#000000", note: "Dia 1.55.1 · Let's go, disabled" })),
      s("Dark · pointer on Continue", "03-onboarding-layout-1-tabs-primary-hover", ...ONB_BUTTONS),
      s("Dark · Continue pressed", "03-onboarding-layout-1-tabs-primary-pressed", ...ONB_BUTTONS),
      s("Dark · pointer on Skip", "03-onboarding-layout-1-tabs-secondary-hover", ...ONB_BUTTONS),
      s("Dark · pointer on Back", "03-onboarding-layout-1-tabs-back-hover", ...ONB_BUTTONS),
    ],
  },
  {
    group: "Sidebar",
    title: "Pinned tiles",
    body: "A faint flat fill and a one-pixel hairline, like Dia. No bright rim, no dark fringe. Pressed draws like hover in both builds.",
    layout: "cols",
    w: 190,
    h: 57,
    states: [
      s("Dark · rest", "10-window-rest", ...TILES, d("04-pinned-rest-dia", 0, 0)),
      s("Dark · pointer on Calendar", "11-tile-hover", ...TILES),
      s("Dark · Calendar pressed", "11-tile-pressed", ...TILES),
      s("Dark · Calendar selected", "11-tile-selected", ...TILES),
      s("Light · rest", "10-window-rest-light", ...TILES, d("04-pinned-rest-light-dia", 0, 0)),
      s("Light · pointer on Calendar", "11-tile-hover-light", ...TILES),
    ],
  },
  {
    group: "Sidebar",
    title: "Tab rows and groups",
    body: "Rows, a row's close button and the group header, at rest and under the pointer.",
    layout: "cols",
    w: 190,
    h: 180,
    states: [
      s("Dark · rest", "10-window-rest", ...ROWS, d("05-sidebar-rest-dia", 0, 0)),
      s("Dark · pointer on Reading list", "12-row-hover", ...ROWS),
      s("Dark · pointer on ✕", "12-row-close-hover", ...ROWS),
      s("Dark · pointer on the group", "13-group-header-hover", ...ROWS),
      s("Light · rest", "10-window-rest-light", ...ROWS, d("05-sidebar-rest-light-dia", 0, 0)),
    ],
  },
  {
    group: "Sidebar",
    title: "Tab hover card",
    body: "Point at a tab and its card opens: the card and its Pin, Bookmark and Split buttons are flat now.",
    layout: "cols",
    w: 280,
    h: 124,
    states: [
      s("Dark · card open", "17-hovercard-rest", ...CARD),
      s("Dark · pointer on Pin", "17-hovercard-pin-hover", ...CARD),
      s("Dark · Pin pressed", "17-hovercard-pin-pressed", ...CARD),
      s("Dark · pointer on Bookmark", "17-hovercard-bookmark-hover", ...CARD),
      s("Light · pointer on Pin", "17-hovercard-pin-hover-light", ...CARD),
    ],
  },
  {
    group: "Toolbar",
    title: "Toolbar buttons",
    body: "The toolbar takes the page's colour, white here. Sidebar, Back, Forward and Reload: nothing at rest, a flat square under the pointer instead of a glass bubble.",
    layout: "rows",
    w: 420,
    h: 42,
    states: [
      s("Dark · rest", "10-window-rest", ...TOOLBAR, d("06-toolbar-rest-dia", 4, 7)),
      s("Dark · pointer on Back", "15-toolbar-back-hover", ...TOOLBAR),
      s("Dark · Back pressed", "15-toolbar-back-pressed", ...TOOLBAR),
      s("Dark · pointer on Reload", "15-toolbar-reload-hover", ...TOOLBAR),
      s("Dark · pointer on the address", "16-address-hover", ...TOOLBAR),
      s("Light · rest", "10-window-rest-light", ...TOOLBAR, d("06-toolbar-rest-light-dia", 4, 7)),
      s("Light · pointer on Back", "15-toolbar-back-hover-light", ...TOOLBAR),
    ],
  },
  {
    group: "Command bar",
    title: "Suggestions",
    body: "A flat panel with Dia's 20 pt corners. The top row takes the window's colour, as in Dia, and the hovered row a light grey.",
    layout: "cols",
    w: 286,
    h: 124,
    states: [
      s("Dark · typed “127”", "18-commandbar-suggestions", ...COMMAND, d("05-commandbar-open-dia", 325, 52, { note: "Dia 1.55.1 · its own query" })),
      s("Dark · pointer on Research", "18-commandbar-suggestion-hover", ...COMMAND),
      s("Dark · Research pressed", "18-commandbar-suggestion-pressed", ...COMMAND),
      s("Light · typed “127”", "18-commandbar-suggestions-light", ...COMMAND, d("05-commandbar-open-light-dia", 325, 52, { note: "Dia 1.55.1 · its own query" })),
    ],
  },
  {
    group: "Popovers",
    title: "Downloads",
    body: "The Downloads popover and its rows are flat panels over the sidebar.",
    layout: "cols",
    w: 312,
    h: 190,
    states: [
      s("Dark · open", "19-downloads-open", ...DOWNLOADS),
      s("Dark · pointer on slides.zip", "19-downloads-row-hover", ...DOWNLOADS),
      s("Dark · pointer on the row button", "19-downloads-row-button-hover", ...DOWNLOADS),
      s("Light · open", "19-downloads-open-light", ...DOWNLOADS),
    ],
  },
  {
    group: "Popovers",
    title: "Site info",
    body: "The site info popover, its four tiles and its rows drop the tinted glass.",
    layout: "cols",
    w: 304,
    h: 330,
    states: [
      s("Dark · open", "20-siteinfo-open", ...SITEINFO),
      s("Dark · pointer on Share", "20-siteinfo-tile-hover", ...SITEINFO),
      s("Dark · pointer on Block Ads", "20-siteinfo-row-hover", ...SITEINFO),
      s("Light · open", "20-siteinfo-open-light", ...SITEINFO),
    ],
  },
  {
    group: "Popovers",
    title: "Peek",
    body: "Peek's frame and its Split, Expand and Close buttons, top right.",
    layout: "cols",
    w: 210,
    h: 80,
    states: [
      s("Dark · open", "21-peek-open", ...PEEK),
      s("Dark · pointer on Split", "21-peek-split-hover", ...PEEK),
      s("Dark · pointer on Close", "21-peek-close-hover", ...PEEK),
      s("Dark · Close pressed", "21-peek-close-pressed", ...PEEK),
      s("Light · pointer on Close", "21-peek-close-hover-light", ...PEEK),
    ],
  },
  {
    group: "New Tab",
    title: "New Tab field",
    body: "The field on New Tab is a flat card, the same as Dia's.",
    layout: "rows",
    w: 668,
    h: 128,
    states: [
      s("Dark · rest", "33-ntp-rest", ...FIELD, d("07-newtab-rest-dia", 526, 363)),
      s("Dark · pointer on the field", "34-ntp-field-hover", ...FIELD),
      s("Light · rest", "33-ntp-rest-light", ...FIELD, d("07-newtab-rest-light-dia", 526, 363)),
    ],
  },
  {
    group: "New Tab",
    title: "Telemetry ask",
    body: "Ardia asks once whether to share crash reports. The card and its buttons are flat now. Dia asks nothing like it.",
    layout: "cols",
    w: 300,
    h: 142,
    states: [
      s("Dark · rest", "30-ntp-telemetry-ask-rest", ...ASK, NO_EQUIVALENT),
      s("Dark · pointer on Share", "30-ntp-telemetry-ask-share-hover", ...ASK, NO_EQUIVALENT),
      s("Dark · Share pressed", "30-ntp-telemetry-ask-share-pressed", ...ASK, NO_EQUIVALENT),
      s("Dark · pointer on Not now", "30-ntp-telemetry-ask-not-now-hover", ...ASK, NO_EQUIVALENT),
      s("Light · rest", "30-ntp-telemetry-ask-rest-light", ...ASK, NO_EQUIVALENT),
    ],
  },
  {
    group: "New Tab",
    title: "Two-button prompts",
    body: "The nearest thing Dia has: the default-browser reminder at the foot of its New Tab, next to the ask's Not now and Share.",
    layout: "cols",
    w: 275,
    h: 40,
    states: [
      s("Dark · rest", "30-ntp-telemetry-ask-rest", ...ASK_BUTTONS, d("03-newtab-default-rest-dia", 344, 16, { note: "Dia 1.55.1 · default-browser reminder" })),
      s("Dark · pointer on Share", "30-ntp-telemetry-ask-share-hover", ...ASK_BUTTONS),
      s("Light · rest", "30-ntp-telemetry-ask-rest-light", ...ASK_BUTTONS, d("03-newtab-default-rest-light-dia", 344, 16, { note: "Dia 1.55.1 · default-browser reminder" })),
    ],
  },
  {
    group: "New Tab",
    title: "Check-in",
    body: "“How are you liking Ardia?” after a week. A flat card with a flat close button.",
    layout: "cols",
    w: 284,
    h: 72,
    states: [
      s("Dark · rest", "31-ntp-checkin-rest", ...CHECKIN, NO_EQUIVALENT),
      s("Dark · pointer on the card", "31-ntp-checkin-hover", ...CHECKIN, NO_EQUIVALENT),
      s("Dark · pressed", "31-ntp-checkin-pressed", ...CHECKIN, NO_EQUIVALENT),
      s("Dark · pointer on ✕", "31-ntp-checkin-close-hover", ...CHECKIN, NO_EQUIVALENT),
      s("Light · rest", "31-ntp-checkin-rest-light", ...CHECKIN, NO_EQUIVALENT),
    ],
  },
  {
    group: "New Tab",
    title: "What's New postcard",
    body: "The What's New postcard that follows an update, at rest and under the pointer.",
    layout: "cols",
    w: 305,
    h: 225,
    states: [
      s("Dark · rest", "32-ntp-postcard-rest", ...POSTCARD, NO_EQUIVALENT),
      s("Dark · pointer on it", "32-ntp-postcard-hover", ...POSTCARD, NO_EQUIVALENT),
      s("Light · rest", "32-ntp-postcard-rest-light", ...POSTCARD, NO_EQUIVALENT),
    ],
  },
  {
    group: "New Tab",
    title: "Personalize",
    body: "The Make it yours panel: a flat panel, flat layout cards, and a ring on the chosen one.",
    layout: "cols",
    w: 368,
    h: 300,
    states: [
      s("Dark · open", "33-ntp-personalize-panel", ...PERSONALIZE, NO_EQUIVALENT),
      s("Dark · pointer on a colour", "33-ntp-personalize-color-hover", ...PERSONALIZE, NO_EQUIVALENT),
      s("Dark · pointer on Classic", "33-ntp-personalize-layout-hover", ...PERSONALIZE, NO_EQUIVALENT),
      s("Dark · Classic pressed", "33-ntp-personalize-layout-pressed", ...PERSONALIZE, NO_EQUIVALENT),
      s("Light · open", "33-ntp-personalize-panel-light", ...PERSONALIZE, NO_EQUIVALENT),
    ],
  },
  {
    group: "Picture in Picture",
    title: "Player window",
    body: "Ardia's own controls over the video, and the handle when it's tucked into the edge. Dia's rest frame is video edge to edge; its controls never showed for the capture.",
    layout: "cols",
    w: 501,
    h: 282,
    states: [
      s("Rest", "40-pip-rest", ...PIP, d("07-pip-rest-dia", -96, -54, { fill: "#111111", note: "Dia 1.55.1 · its own 309 × 174 window" })),
      s("Controls showing", "40-pip-controls", ...PIP),
      s("Pointer on Close", "40-pip-close-hover", ...PIP),
      s("Tucked into the edge", "41-pip-stashed", ...PIP),
      s("Pointer on the handle", "41-pip-handle-hover", ...PIP),
    ],
  },
  {
    group: "Picture in Picture",
    title: "Player buttons, close up",
    body: "The corner plates. Glass drew a lit rim and, once pressed, lit both plates at once; flat draws one plain square.",
    layout: "rows",
    w: 501,
    h: 54,
    states: [
      s("Controls showing", "40-pip-controls", ...PIP),
      s("Pointer on Back", "40-pip-back-hover", ...PIP),
      s("Back pressed", "40-pip-back-pressed", ...PIP),
      s("Pointer on Close", "40-pip-close-hover", ...PIP),
    ],
  },
];

const sceneLength = (scene: Scene) => LEAD + scene.states.length * STATE + TAIL;
const starts = SCENES.map((_, i) => INTRO + SCENES.slice(0, i).reduce((sum, sc) => sum + sceneLength(sc), 0));
const total = INTRO + SCENES.reduce((sum, sc) => sum + sceneLength(sc), 0) + OUTRO;

export const meta = { width: 1920, height: 1080, fps: FPS, durationInFrames: total };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const label: CSSProperties = {
  fontFamily: font.mono,
  fontWeight: 460,
  fontStretch: "87.5%",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontSize: 20,
  color: color.ink2,
};

function scaleFor(scene: Scene) {
  const box = scene.layout === "rows" ? ROW_BOX : COL_BOX;
  const raw = Math.min(box.w / scene.w, box.h / scene.h);
  const whole = Math.floor(raw);
  const crisp = whole >= 2 && whole / raw >= 0.85;
  const k = crisp ? whole : raw;
  return { k, crisp, w: Math.round(scene.w * k), h: Math.round(scene.h * k) };
}

type Place = { left: number; top: number; w: number; h: number };
const COLUMNS: Column[] = ["before", "after", "dia"];

function placements(scene: Scene): Place[] {
  const { w, h } = scaleFor(scene);
  if (scene.layout === "rows") {
    const block = 3 * h + 2 * ROW_GAP;
    const top = ROW_TOP + Math.max(0, (3 * ROW_BOX.h + 2 * ROW_GAP - block) / 2);
    const left = ROW_LEFT + (ROW_BOX.w - w) / 2;
    return COLUMNS.map((_, i) => ({ left, top: top + i * (h + ROW_GAP), w, h }));
  }
  const top = COL_TOP + (COL_BOX.h - h) / 2;
  return COLUMNS.map((_, i) => ({ left: MARGIN + i * (COL_BOX.w + COL_GAP) + (COL_BOX.w - w) / 2, top, w, h }));
}

function currentIndex(scene: Scene, frame: number) {
  return Math.min(scene.states.length - 1, Math.max(0, Math.floor((frame - LEAD) / STATE)));
}

function fadeIn(index: number, frame: number) {
  const start = LEAD + index * STATE;
  return index === 0 ? 1 : interpolate(frame, [start, start + FADE], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
}

function ColumnLabel({ column, note, style }: { column: Column; note?: string; style: CSSProperties }) {
  const filled = column !== "before";
  return (
    <div style={{ position: "absolute", display: "flex", flexDirection: "column", gap: 8, ...style }}>
      <div
        style={{
          ...label,
          alignSelf: "flex-start",
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1,
          color: filled ? color.paper : color.ink,
          background: column === "after" ? color.blue : filled ? color.ink : "transparent",
          boxShadow: filled ? "none" : `inset 0 0 0 3px ${color.ink}`,
          padding: "9px 18px 8px",
          borderRadius: 10,
        }}
      >
        {column === "before" ? "Before" : column === "after" ? "After" : "Dia"}
      </div>
      <div style={{ ...label, fontSize: 17, whiteSpace: "nowrap" }}>{note ?? VERSIONS[column]}</div>
    </div>
  );
}

function StillImage({ column, file, x, y, k, crisp, opacity }: { column: Column; file: string; x: number; y: number; k: number; crisp: boolean; opacity: number }) {
  return (
    <Img
      src={staticFile(`footage/dia-look/${column}/${file}.png`)}
      style={{
        position: "absolute",
        left: -x * k,
        top: -y * k,
        maxWidth: "none",
        transform: `scale(${k})`,
        transformOrigin: "0 0",
        imageRendering: crisp ? "pixelated" : "auto",
        opacity,
      }}
    />
  );
}

function GapCard({ gap, opacity }: { gap: Gap; opacity: number }) {
  return (
    <AbsoluteFill
      style={{
        opacity,
        alignItems: "center",
        justifyContent: "center",
        background: `repeating-linear-gradient(135deg, ${color.paperDeep} 0 14px, ${color.paper} 14px 28px)`,
      }}
    >
      <div style={{ ...label, fontSize: 24, fontWeight: 650, color: color.ink, background: color.paper, padding: "10px 16px 9px", borderRadius: 10, boxShadow: `inset 0 0 0 2px ${color.rule}`, textAlign: "center" }}>
        {gap.gap === "not-captured" ? "Not captured in Dia" : "Dia has no equivalent"}
      </div>
    </AbsoluteFill>
  );
}

function Panel({ scene, column, place, frame }: { scene: Scene; column: Column; place: Place; frame: number }) {
  const { k, crisp } = scaleFor(scene);
  const current = currentIndex(scene, frame);
  return (
    <div
      style={{
        position: "absolute",
        left: place.left,
        top: place.top,
        width: place.w,
        height: place.h,
        overflow: "hidden",
        borderRadius: 16,
        background: color.paperDeep,
        boxShadow: "0 24px 60px rgba(22,19,15,0.16), 0 0 0 1px rgba(22,19,15,0.10)",
      }}
    >
      {scene.states.map((state, index) => {
        if (index > current) return null;
        const opacity = fadeIn(index, frame);
        if (column !== "dia") return <StillImage key={index} column={column} file={state.file} x={state.x} y={state.y} k={k} crisp={crisp} opacity={opacity} />;
        if (isGap(state.dia)) return <GapCard key={index} gap={state.dia} opacity={opacity} />;
        return (
          <AbsoluteFill key={index} style={{ opacity, background: state.dia.fill ?? color.paperDeep }}>
            <StillImage column="dia" file={state.dia.file} x={state.dia.x} y={state.dia.y} k={k} crisp={crisp} opacity={1} />
          </AbsoluteFill>
        );
      })}
    </div>
  );
}

const number = (i: number) => `${String(i + 1).padStart(2, "0")} / ${String(SCENES.length).padStart(2, "0")}`;

function SceneView({ scene, index }: { scene: Scene; index: number }) {
  const frame = useCurrentFrame();
  const length = sceneLength(scene);
  const shown = interpolate(frame, [0, SCENE_FADE, length - SCENE_FADE, length], [0, 1, 1, 0], clamp);
  const current = currentIndex(scene, frame);
  const state = scene.states[current]!;
  const pillIn = fadeIn(current, frame);
  const places = placements(scene);
  const rows = scene.layout === "rows";
  const diaNote = isGap(state.dia) ? undefined : state.dia.note;
  return (
    <AbsoluteFill style={{ opacity: shown }}>
      <div style={{ position: "absolute", left: MARGIN, top: 40, right: MARGIN, display: "flex", justifyContent: "space-between" }}>
        <div style={{ ...label, color: color.ink }}>Ardia · Dia's flat look · {scene.group}</div>
        <div style={{ ...label, color: color.blue }}>{number(index)}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          top: 84,
          width: 900,
          fontFamily: font.poster,
          fontWeight: 850,
          fontStretch: "75%",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          fontSize: 64,
          lineHeight: 0.98,
          color: color.ink,
        }}
      >
        {scene.title}
      </div>
      <div style={{ position: "absolute", left: 1000, top: 88, width: 860, fontFamily: font.serif, fontSize: 29, lineHeight: 1.27, color: color.ink }}>{scene.body}</div>
      {COLUMNS.map((column, i) => (
        <ColumnLabel
          key={column}
          column={column}
          note={column === "dia" ? diaNote : undefined}
          style={rows ? { left: MARGIN, top: places[i]!.top + places[i]!.h / 2 - 34 } : { left: places[i]!.left, top: places[i]!.top - 86 }}
        />
      ))}
      {COLUMNS.map((column, i) => (
        <Panel key={column} scene={scene} column={column} place={places[i]!} frame={frame} />
      ))}
      <div style={{ position: "absolute", left: 0, right: 0, top: PILL_TOP, display: "flex", justifyContent: "center", opacity: pillIn }}>
        <div style={{ ...label, fontSize: 26, fontWeight: 620, color: color.paper, background: color.ink, padding: "10px 18px 9px", borderRadius: 10 }}>{state.label}</div>
      </div>
    </AbsoluteFill>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const rise = (delay: number) => ({
    opacity: interpolate(frame, [delay, delay + 24], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [delay, delay + 33], [28, 0], { ...clamp, easing: Easing.out(Easing.cubic) })}px)`,
  });
  const out = interpolate(frame, [INTRO - 15, INTRO], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, opacity: out }}>
      <div style={{ ...label, fontSize: 26, color: color.blue, ...rise(3) }}>Before · After · Dia</div>
      <div style={{ marginTop: 20, fontFamily: font.poster, fontWeight: 860, fontStretch: "75%", fontSize: 200, lineHeight: 0.9, color: color.ink, textTransform: "uppercase", ...rise(9) }}>
        Back to flat
      </div>
      <div style={{ marginTop: 30, maxWidth: 1100, fontFamily: font.serif, fontSize: 40, lineHeight: 1.25, color: color.ink2, ...rise(18) }}>
        Liquid glass is gone from Ardia. Every surface, at rest, under the pointer and pressed, next to Dia where Dia has one.
      </div>
      <Img src={staticFile("brand/app-icon.png")} style={{ position: "absolute", right: 170, top: 330, width: 420, height: 420, ...rise(15) }} />
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity }}>
      <Img src={staticFile("brand/app-icon.png")} style={{ width: 200, height: 200 }} />
      <div style={{ marginTop: 28, fontFamily: font.poster, fontWeight: 760, fontStretch: "87.5%", fontSize: 60, color: color.ink }}>Flat everywhere</div>
      <div style={{ marginTop: 16, fontFamily: font.serif, fontSize: 32, color: color.ink2 }}>Same states, same window, captured from both builds.</div>
      <div style={{ ...label, marginTop: 22, fontSize: 24, color: color.blue }}>ardia.dev</div>
    </AbsoluteFill>
  );
}

export default function DiaLook() {
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {SCENES.map((scene, i) => (
        <Sequence key={scene.title} from={starts[i]} durationInFrames={sceneLength(scene)}>
          <SceneView scene={scene} index={i} />
        </Sequence>
      ))}
      <Sequence from={total - OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
