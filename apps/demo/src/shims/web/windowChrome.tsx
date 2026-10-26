import { useSyncExternalStore } from "react";
import { useBrowser } from "../../../../browser/src/state/browser/store";

const DEFAULT_CENTER: [number, number] = [25, 27];
const SPACING = 23;
const DIAMETER = 14;
const RIM = 0.5;
const STOPS = [0, 0.2, 0.4, 0.6, 0.8, 1];

const ART = {
  light: {
    close: { interior: ["color(display-p3 0.9216 0.4627 0.4118)", "color(display-p3 0.9176 0.4627 0.4157)", "color(display-p3 0.9098 0.4863 0.4431)", "color(display-p3 0.9020 0.5137 0.4784)", "color(display-p3 0.8941 0.5412 0.5059)", "color(display-p3 0.8824 0.5098 0.4784)"], rim: ["color(display-p3 0.8824 0.4196 0.3647)", "color(display-p3 0.8431 0.3765 0.3294)", "color(display-p3 0.8235 0.3569 0.3176)", "color(display-p3 0.7922 0.3176 0.2784)", "color(display-p3 0.8157 0.4157 0.3843)", "color(display-p3 0.8627 0.5294 0.5059)"] },
    minimize: { interior: ["color(display-p3 0.9412 0.7294 0.3020)", "color(display-p3 0.9451 0.7412 0.2980)", "color(display-p3 0.9569 0.7725 0.3216)", "color(display-p3 0.9569 0.8000 0.3529)", "color(display-p3 0.9608 0.8196 0.3725)", "color(display-p3 0.9412 0.7922 0.3569)"], rim: ["color(display-p3 0.8627 0.6471 0.2627)", "color(display-p3 0.8078 0.6000 0.2392)", "color(display-p3 0.8000 0.5882 0.2235)", "color(display-p3 0.7608 0.5333 0.1255)", "color(display-p3 0.8078 0.6235 0.2902)", "color(display-p3 0.8902 0.7451 0.4196)"] },
    zoom: { interior: ["color(display-p3 0.4902 0.7961 0.2863)", "color(display-p3 0.5059 0.8000 0.3137)", "color(display-p3 0.5569 0.8000 0.3725)", "color(display-p3 0.6039 0.8078 0.4392)", "color(display-p3 0.6431 0.8078 0.4902)", "color(display-p3 0.6118 0.7882 0.4588)"], rim: ["color(display-p3 0.4392 0.7255 0.2549)", "color(display-p3 0.4039 0.6588 0.2471)", "color(display-p3 0.4000 0.6314 0.2588)", "color(display-p3 0.3608 0.5843 0.2353)", "color(display-p3 0.4902 0.6431 0.3686)", "color(display-p3 0.6196 0.7451 0.4863)"] },
  },
  dark: {
    close: { interior: ["color(display-p3 0.9059 0.4353 0.3843)", "color(display-p3 0.8941 0.3882 0.3333)", "color(display-p3 0.8824 0.3804 0.3294)", "color(display-p3 0.8784 0.4235 0.3804)", "color(display-p3 0.8706 0.4392 0.4000)", "color(display-p3 0.9961 0.6275 0.5882)"], rim: ["color(display-p3 1.0000 0.6431 0.5922)", "color(display-p3 0.9490 0.4824 0.4392)", "color(display-p3 0.8863 0.3882 0.3333)", "color(display-p3 0.8784 0.3686 0.3137)", "color(display-p3 0.8392 0.4314 0.3961)", "color(display-p3 0.8235 0.5608 0.5333)"] },
    minimize: { interior: ["color(display-p3 0.9412 0.7216 0.2157)", "color(display-p3 0.9412 0.7098 0.0000)", "color(display-p3 0.9490 0.7412 0.0000)", "color(display-p3 0.9569 0.7843 0.2627)", "color(display-p3 0.9647 0.8118 0.3294)", "color(display-p3 1.0000 0.9569 0.4471)"], rim: ["color(display-p3 0.9961 0.8824 0.3922)", "color(display-p3 0.9843 0.7725 0.2627)", "color(display-p3 0.9529 0.7451 0.0196)", "color(display-p3 0.9569 0.7569 0.0000)", "color(display-p3 0.8784 0.7412 0.2118)", "color(display-p3 0.8235 0.8078 0.4000)"] },
    zoom: { interior: ["color(display-p3 0.4314 0.7608 0.2667)", "color(display-p3 0.3529 0.7373 0.0314)", "color(display-p3 0.3373 0.7294 0.0039)", "color(display-p3 0.4118 0.7490 0.2549)", "color(display-p3 0.4392 0.7569 0.3137)", "color(display-p3 0.5961 0.9216 0.4706)"], rim: ["color(display-p3 0.6235 0.9451 0.4745)", "color(display-p3 0.4667 0.8039 0.3137)", "color(display-p3 0.3490 0.7333 0.0510)", "color(display-p3 0.3020 0.7255 0.0000)", "color(display-p3 0.3922 0.7020 0.2118)", "color(display-p3 0.5373 0.7843 0.4196)"] },
  },
} as const;

type Light = keyof (typeof ART)["light"];
const LIGHTS: Light[] = ["close", "minimize", "zoom"];

let center: [number, number] | null = DEFAULT_CENTER;
const watchers = new Set<() => void>();

export function setTrafficLightsCenter(_windowId: string, next: [number, number] | null) {
  center = next ?? DEFAULT_CENTER;
  for (const watcher of watchers) watcher();
  return Promise.resolve();
}

function TrafficLight({ name, theme }: { name: Light; theme: keyof typeof ART }) {
  const { interior, rim } = ART[theme][name];
  const id = `ardia-light-${theme}-${name}`;
  const r = DIAMETER / 2;
  return (
    <svg width={DIAMETER} height={DIAMETER} viewBox={`0 0 ${DIAMETER} ${DIAMETER}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          {interior.map((color, i) => (
            <stop key={i} offset={STOPS[i]} style={{ stopColor: color }} />
          ))}
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          {rim.map((color, i) => (
            <stop key={i} offset={STOPS[i]} style={{ stopColor: color }} />
          ))}
        </linearGradient>
      </defs>
      <circle cx={r} cy={r} r={r - RIM / 2} fill={`url(#${id}-fill)`} stroke={`url(#${id}-rim)`} strokeWidth={RIM} />
    </svg>
  );
}

export function TrafficLights() {
  const at = useSyncExternalStore(
    (watch) => (watchers.add(watch), () => void watchers.delete(watch)),
    () => center,
  );
  const theme = useBrowser((s) => (s.ui.appDark ? "dark" : "light"));
  if (!at) return null;
  return (
    <div aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 1000 }}>
      {LIGHTS.map((name, i) => (
        <div key={name} style={{ position: "absolute", left: at[0] + i * SPACING - DIAMETER / 2, top: at[1] - DIAMETER / 2 }}>
          <TrafficLight name={name} theme={theme} />
        </div>
      ))}
    </div>
  );
}
