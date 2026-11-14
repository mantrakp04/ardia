const SAME_PRESS_MS = 600;

let pressedAway: { windowId: string; at: number } | null = null;

export function noteDownloadsClosedByPress(windowId: string, now = Date.now()) {
  pressedAway = { windowId, at: now };
}

export function downloadsClosedByThisPress(windowId: string, now = Date.now()) {
  const away = pressedAway;
  pressedAway = null;
  return !!away && away.windowId === windowId && now - away.at < SAME_PRESS_MS;
}
