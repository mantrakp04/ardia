import { noteIssued, webviewMount, webviews } from "./webviews";

type Navigation = { url: string; seq: number; userInitiated?: boolean };

const started = new Map<string, { seq: number; mount: object }>();

export function startNavigation(tabId: string, navigation: Navigation) {
  const view = webviews.get(tabId);
  const mount = webviewMount(tabId);
  if (!view || !mount) return;
  started.set(tabId, { seq: navigation.seq, mount });
  noteIssued(tabId, navigation.seq);
  void view.loadUrl(navigation.url, { userInitiated: !!navigation.userInitiated });
}

export function takeStartedNavigation(tabId: string, seq: number | undefined) {
  const start = started.get(tabId);
  if (!start || seq === undefined || start.seq !== seq) return false;
  started.delete(tabId);
  return start.mount === webviewMount(tabId);
}
