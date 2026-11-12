const darkWindows = new Set<string>();

export function setWindowDark(windowId: string, dark: boolean) {
  if (dark) darkWindows.add(windowId);
  else darkWindows.delete(windowId);
}

export const isWindowDark = (windowId: string) => darkWindows.has(windowId);
