import type { CSSProperties } from "react";
import { srgbCss, type Vec4 } from "./colors";
import { HALO } from "./uniforms";

const fill: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = `
@keyframes ardia-powerup-rise { from { transform: translateY(60%); } to { transform: translateY(0%); } }
@keyframes ardia-powerup-fade { 0% { opacity: 0; } 4% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ardia-halo-glow { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
`;
  document.head.appendChild(style);
}

export function BackdropFallback({ colors, angle }: { colors: string[]; angle: number }) {
  const [a, b] = [colors[0], colors[colors.length - 1] ?? colors[0]];
  return <div style={{ ...fill, background: `linear-gradient(in oklab ${angle}deg, ${a}, ${b})` }} />;
}

export function PowerUpFallback({ srgb, speed }: { srgb: Vec4[]; speed: number }) {
  injectKeyframes();
  const s = Math.max(speed, 0.01);
  const fadeEnd = (3 - 0.45) / (0.75 * s);
  const stops = srgb.map((c) => srgbCss(c, c[3] * 0.1)).join(", ");
  return (
    <div style={{ ...fill, overflow: "hidden", filter: "blur(24px)", animation: `ardia-powerup-fade ${fadeEnd}s linear forwards` }}>
      <div
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          top: "20%",
          bottom: 0,
          background: `linear-gradient(to top, ${stops})`,
          animation: `ardia-powerup-rise ${1.2 / s}s cubic-bezier(0.76, 0, 0.24, 1) forwards`,
        }}
      />
    </div>
  );
}

export function HaloFallback({ color, speed, cornerRadius, dark }: { color: Vec4; speed: number; cornerRadius: number; dark: boolean }) {
  injectKeyframes();
  const duration = (1 + HALO.fadeOutDuration + HALO.delay) / (0.8 * Math.max(speed, 0.01));
  return (
    <div
      style={{
        position: "absolute",
        inset: HALO.inset,
        borderRadius: cornerRadius,
        boxShadow: `0 0 0 1px ${srgbCss(color, dark ? 0.4 : 1)}, 0 0 24px ${srgbCss(color, dark ? 0.25 : 0.35)}`,
        opacity: 0,
        animation: `ardia-halo-glow ${duration}s ease-out forwards`,
      }}
    />
  );
}
