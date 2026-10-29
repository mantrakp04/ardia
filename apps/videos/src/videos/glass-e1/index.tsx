import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { color, font, loadFonts } from "../../lib/ac-launch/theme";

loadFonts();

const FPS = 30;
const INTRO = 2.4 * FPS;
const STATE_LENGTH = 1.7 * FPS;
const FADE = 8;
const IMAGE_SCALE = 0.5;

interface State {
  file: string;
  label: string;
}

interface Scene {
  title: string;
  body: string;
  width: number;
  height: number;
  zoom: number;
  states: State[];
}

const SCENES: Scene[] = [
  {
    title: "Address field and pinned tiles",
    body: "The field is clear glass at full strength with a hairline rim, like the tiles. The active tile keeps its brighter tint.",
    width: 476,
    height: 202,
    zoom: 3.2,
    states: [
      { file: "sidebar-top-rest", label: "Rest" },
      { file: "sidebar-top-field-hover", label: "Pointer on the field" },
      { file: "sidebar-top-tile-hover", label: "Pointer on a tile" },
    ],
  },
  {
    title: "Toolbar buttons",
    body: "Back, forward, reload and the sidebar button light up as glass instead of a flat grey square.",
    width: 476,
    height: 96,
    zoom: 3.2,
    states: [
      { file: "toolbar-buttons-rest", label: "Rest" },
      { file: "toolbar-buttons-reload-hover", label: "Pointer on reload" },
    ],
  },
  {
    title: "Tab hover card",
    body: "The card is a glass panel over the page, and Pin, Bookmark and Split are glass buttons.",
    width: 1024,
    height: 328,
    zoom: 1.75,
    states: [
      { file: "hover-card-open", label: "Card open" },
      { file: "hover-card-pin-hover", label: "Pointer on Pin" },
    ],
  },
  {
    title: "Downloads",
    body: "The row under the pointer becomes a glass plate with the same rim.",
    width: 660,
    height: 660,
    zoom: 1.9,
    states: [
      { file: "downloads-open", label: "Open" },
      { file: "downloads-row-hover", label: "Pointer on a row" },
    ],
  },
  {
    title: "Sidebar player",
    body: "The now-playing strip is the same clear glass as the tiles above it.",
    width: 476,
    height: 168,
    zoom: 3.2,
    states: [
      { file: "sidebar-player-shown", label: "Playing" },
      { file: "sidebar-player-hover", label: "Pointer on the player" },
    ],
  },
];

const sceneLength = (scene: Scene) => scene.states.length * STATE_LENGTH + FADE;

export const meta = {
  durationInFrames: INTRO + SCENES.reduce((sum, scene) => sum + sceneLength(scene), 0),
  fps: FPS,
  width: 1920,
  height: 1080,
};

function Intro() {
  const frame = useCurrentFrame();
  const shown = interpolate(frame, [0, 12, INTRO - FADE, INTRO], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: color.paper, alignItems: "center", justifyContent: "center", opacity: shown }}>
      <div style={{ fontFamily: font.poster, fontSize: 96, fontWeight: 800, color: color.ink, letterSpacing: -2 }}>One liquid glass</div>
      <div style={{ fontFamily: font.serif, fontSize: 40, color: color.ink2, marginTop: 18 }}>Before and after, on macOS 26</div>
    </AbsoluteFill>
  );
}

function Shot({ side, scene, frame }: { side: "before" | "after"; scene: Scene; frame: number }) {
  const current = Math.min(scene.states.length - 1, Math.floor(frame / STATE_LENGTH));
  const width = scene.width * IMAGE_SCALE * scene.zoom;
  const height = scene.height * IMAGE_SCALE * scene.zoom;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontFamily: font.mono, fontSize: 24, color: side === "after" ? color.blue : color.ink2, textTransform: "uppercase", letterSpacing: 2 }}>{side}</div>
      <div style={{ position: "relative", width, height, borderRadius: 18, overflow: "hidden", boxShadow: "0 18px 50px rgba(22,19,15,0.22)" }}>
        {scene.states.map((state, index) => {
          const start = index * STATE_LENGTH;
          const opacity = index === 0 ? 1 : interpolate(frame, [start, start + FADE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          return index > current ? null : (
            <Img key={state.file} src={staticFile(`footage/glass-e1/${side}/${state.file}.png`)} style={{ position: "absolute", inset: 0, width, height, opacity }} />
          );
        })}
      </div>
    </div>
  );
}

function SceneView({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame();
  const length = sceneLength(scene);
  const shown = interpolate(frame, [0, FADE, length - FADE, length], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  const current = Math.min(scene.states.length - 1, Math.floor(frame / STATE_LENGTH));
  const stacked = scene.width * IMAGE_SCALE * scene.zoom * 2 + 80 > 1760;
  return (
    <AbsoluteFill style={{ background: color.paper, padding: "70px 80px", opacity: shown }}>
      <div style={{ fontFamily: font.poster, fontSize: 60, fontWeight: 800, color: color.ink, letterSpacing: -1 }}>{scene.title}</div>
      <div style={{ fontFamily: font.serif, fontSize: 30, color: color.ink2, marginTop: 10, maxWidth: 1500 }}>{scene.body}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: stacked ? "column" : "row", alignItems: "center", justifyContent: "center", gap: stacked ? 30 : 80 }}>
        <Shot side="before" scene={scene} frame={frame} />
        <Shot side="after" scene={scene} frame={frame} />
      </div>
      <div style={{ fontFamily: font.mono, fontSize: 24, color: color.ink2, textAlign: "center" }}>{scene.states[current]!.label}</div>
    </AbsoluteFill>
  );
}

export default function GlassE1() {
  let start = INTRO;
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      <Sequence durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      {SCENES.map((scene) => {
        const from = start;
        start += sceneLength(scene);
        return (
          <Sequence key={scene.title} from={from} durationInFrames={sceneLength(scene)}>
            <SceneView scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
