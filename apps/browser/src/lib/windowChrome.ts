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

export function trailingClearance(top: number, margin: number, chrome: WindowChrome = WINDOW_CHROME): number {
  return Math.max(margin, captionRoom(0, top, chrome));
}
