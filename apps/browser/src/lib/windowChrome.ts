import { WINDOW_CHROME, type WindowChrome } from "./platformChrome";

export { WINDOW_CHROME, type WindowChrome };

export function captionRoom(fromRight: number, fromTop = 0, chrome: WindowChrome = WINDOW_CHROME): number {
  if (fromTop >= chrome.titleBarHeight) return 0;
  return Math.max(0, chrome.trailingWidth - fromRight);
}

export function captionClearTop(top: number, rowHeight: number, fromRight: number, chrome: WindowChrome = WINDOW_CHROME): number {
  if (!captionRoom(fromRight, top, chrome)) return top;
  return Math.max(top, chrome.titleBarHeight - rowHeight);
}

export function trailingClearance(top: number, margin: number, controlsBottom: number, chrome: WindowChrome = WINDOW_CHROME): number {
  return top < controlsBottom ? Math.max(margin, chrome.trailingWidth) : margin;
}

export const WINDOW_CONTROLS = { edge: 12, gap: 3, button: 30, regular: 30, small: 28, band: 26, strip: 18 } as const;

export const windowControlsWidth = (count = 3) => count * WINDOW_CONTROLS.button + (count - 1) * WINDOW_CONTROLS.gap;
