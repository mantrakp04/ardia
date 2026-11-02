import { useLayoutEffect, useRef, useState } from "react";
import { View, type ViewProps } from "react-native";
import { useBrowser } from "../../../../../browser/src/state/browser/store";

const LINE_WIDTH = 1.5;
const ARC = 0.72;
const TURN_MS = 1880;
const TRACK_ALPHA = 0.18;
const SECONDARY_LABEL = { light: "rgba(0,0,0,0.5)", dark: "rgba(255,255,255,0.55)" };
const SECONDARY_TRACK = { light: `rgba(0,0,0,${0.5 * TRACK_ALPHA})`, dark: `rgba(255,255,255,${0.55 * TRACK_ALPHA})` };
const KEYFRAMES_ID = "ardia-activity-spinner";

function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes ${KEYFRAMES_ID} { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head.append(style);
}

export function ActivitySpinner({ style, ...props }: ViewProps) {
  const dark = useBrowser((s) => s.ui.appDark);
  const host = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    ensureKeyframes();
    const node = host.current;
    if (!node) return;
    const measure = () => setSize(Math.min(node.clientWidth, node.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const tone = dark ? "dark" : "light";
  const radius = Math.max(0, size / 2 - 1.25);
  const circumference = 2 * Math.PI * radius;
  return (
    <View {...props} pointerEvents="none" ref={(view) => void (host.current = view as unknown as HTMLElement | null)} style={style}>
      {size > 0 ? (
        <svg width={size} height={size} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={SECONDARY_TRACK[tone]} strokeWidth={LINE_WIDTH} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={SECONDARY_LABEL[tone]}
            strokeWidth={LINE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${circumference * ARC} ${circumference}`}
            style={{ transformOrigin: "50% 50%", animation: `${KEYFRAMES_ID} ${TURN_MS}ms linear infinite` }}
          />
        </svg>
      ) : null}
    </View>
  );
}
