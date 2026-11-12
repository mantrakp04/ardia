import { REPLAY_SAMPLE_RATE, REPLAY_START_AFTER_LOAD_MS, REPLAY_START_IDLE_MS } from "../../data/telemetry";
import { sessionId } from "./core";

export function sampled(id: string): boolean {
  if (REPLAY_SAMPLE_RATE >= 1) return true;
  const bits = parseInt(id.replace(/-/g, "").slice(-8), 16);
  return Number.isFinite(bits) && bits / 0xffffffff < REPLAY_SAMPLE_RATE;
}

const FIRST_INPUT = ["pointerdown", "keydown"] as const;

export function startReplay() {
  if (!sampled(sessionId())) return;
  let scheduled = false;
  const load = () => import("./recorder").then((m) => m.record()).catch(() => {});
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    for (const type of FIRST_INPUT) removeEventListener(type, schedule, true);
    if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: REPLAY_START_IDLE_MS });
    else setTimeout(load, 0);
  };
  for (const type of FIRST_INPUT) addEventListener(type, schedule, { capture: true, passive: true });
  const later = () => setTimeout(schedule, REPLAY_START_AFTER_LOAD_MS);
  if (document.readyState === "complete") later();
  else addEventListener("load", later, { once: true });
}
