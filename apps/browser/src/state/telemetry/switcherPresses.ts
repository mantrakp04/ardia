import { isSharing, useTelemetry } from "./client";

const CORRECTION_WINDOW_MS = 2000;
const SWITCH_MATCH_MS = 3000;
const KEPT_PRESSES = 4;

type SwitcherPress = { windowId: string; profileId: string; icons: boolean; corrected: boolean; at: number; matched: boolean };

let presses: SwitcherPress[] = [];

useTelemetry.subscribe((s, prev) => {
  if (prev.sharing && !s.sharing) presses = [];
});

export function noteSwitcherPress(windowId: string, profileId: string, icons: boolean, now = Date.now()) {
  if (!isSharing()) return;
  const previous = presses.at(-1);
  const corrected = !!previous && previous.windowId === windowId && previous.profileId !== profileId && now - previous.at < CORRECTION_WINDOW_MS;
  presses = [...presses.slice(1 - KEPT_PRESSES), { windowId, profileId, icons, corrected, at: now, matched: false }];
}

export function switcherSwitchProperties(windowId: string, profileId: string, now = Date.now()) {
  const press = [...presses].reverse().find((p) => !p.matched && p.windowId === windowId && p.profileId === profileId && now - p.at < SWITCH_MATCH_MS);
  if (!press) return { via_switcher: false };
  press.matched = true;
  return { via_switcher: true, switcher_icons: press.icons, switcher_corrected: press.corrected };
}
