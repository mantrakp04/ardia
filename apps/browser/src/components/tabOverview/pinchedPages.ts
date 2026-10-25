import { useBrowser } from "../../store/browser";

const pinchedAt = new Map<string, string>();
const handlesPinchAt = new Map<string, string>();
const PDF = /\.pdf(?:$|[?#])/i;

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

export function notePageHandlesPinch(tabId: string) {
  const tabs = useBrowser.getState().tabs;
  for (const id of handlesPinchAt.keys()) if (!tabs[id]) handlesPinchAt.delete(id);
  if (tabs[tabId]) handlesPinchAt.set(tabId, tabs[tabId]!.url);
}

function handlesPinch(tabId: string): boolean {
  if (!handlesPinchAt.has(tabId)) return false;
  if (useBrowser.getState().tabs[tabId]?.url === handlesPinchAt.get(tabId)) return true;
  handlesPinchAt.delete(tabId);
  return false;
}

export function isPdfUrl(url: string): boolean {
  try {
    return PDF.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function pageOwnsPinch(tabId: string | null | undefined): boolean {
  if (!tabId) return false;
  const url = useBrowser.getState().tabs[tabId]?.url ?? "";
  return pagePinched(tabId) || handlesPinch(tabId) || isPdfUrl(url);
}

export function pinchedTabCount(): number {
  return pinchedAt.size + handlesPinchAt.size;
}

if (typeof __DEV__ !== "undefined" && __DEV__) (globalThis as { acPinchedPages?: unknown }).acPinchedPages = { pageOwnsPinch };
