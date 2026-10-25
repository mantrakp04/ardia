import { useBrowser } from "../../store/browser";

const pinchedAt = new Map<string, string>();

export function notePinchScale(tabId: string, scale: number) {
  const tabs = useBrowser.getState().tabs;
  for (const id of pinchedAt.keys()) if (!tabs[id]) pinchedAt.delete(id);
  if (scale > 1.01 && tabs[tabId]) pinchedAt.set(tabId, tabs[tabId]!.url);
  else pinchedAt.delete(tabId);
}

export function pagePinched(tabId: string | null | undefined): boolean {
  if (!tabId || !pinchedAt.has(tabId)) return false;
  if (useBrowser.getState().tabs[tabId]?.url === pinchedAt.get(tabId)) return true;
  pinchedAt.delete(tabId);
  return false;
}

export function pinchedTabCount(): number {
  return pinchedAt.size;
}
