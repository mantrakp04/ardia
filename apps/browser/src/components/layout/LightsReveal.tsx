import { useLayoutEffect } from "react";
import { useWindowId } from "../../store/hooks";
import { setLightsReveal } from "./trafficLights";

export function LightsReveal({ enabled }: { enabled: boolean }) {
  const windowId = useWindowId();
  useLayoutEffect(() => setLightsReveal(windowId, enabled ? "live" : "off"), [windowId, enabled]);
  useLayoutEffect(() => () => setLightsReveal(windowId, null), [windowId]);
  return null;
}
