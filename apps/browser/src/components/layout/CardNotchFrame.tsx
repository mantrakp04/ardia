import { CardNotch } from "@ardia/shell";
import type { ReactNode } from "react";
import { ARC_PEEK_OUT_MS, ARC_PEEK_SPRING } from "./dockMotion";
import { useLightsReveals, useSideSwitches } from "./trafficLights";
import { LIGHTS_BUBBLE, LIGHTS_NOTCH } from "./lightsCorner";

const NOTCH: [number, number] = [LIGHTS_NOTCH.width, LIGHTS_NOTCH.height];
const BUBBLE: [number, number] = [LIGHTS_BUBBLE.width, LIGHTS_BUBBLE.height];
const SPRING: [number, number] = [ARC_PEEK_SPRING.response, ARC_PEEK_SPRING.damping];

export function CardNotchFrame({ windowId, children }: { windowId: string; children: ReactNode }) {
  const live = useLightsReveals((r) => r[windowId] === "live");
  const switching = useSideSwitches((r) => !!r[windowId]);
  if (!CardNotch) return <>{children}</>;
  return (
    <CardNotch
      style={{ flex: 1 }}
      active={live}
      drivesLights={live}
      frozen={switching}
      notch={NOTCH}
      radius={LIGHTS_NOTCH.radius}
      bubble={BUBBLE}
      zone={LIGHTS_BUBBLE.zone}
      slack={LIGHTS_BUBBLE.slack}
      spring={SPRING}
      closeDuration={ARC_PEEK_OUT_MS}
    >
      {children}
    </CardNotch>
  );
}
