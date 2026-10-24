import { useBrowser } from "../store/browser";
import { isIncognitoProfile } from "../store/model";
import { webviews } from "./webviews";

type Picture = { data: string; frame: [number, number, number, number] };

const SETTLE_MS = 1500;
const KEEP = 40;
const pictures = new Map<string, Picture>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let started = false;

export function lastPicture(tabId: string): Picture | null {
  return pictures.get(tabId) ?? null;
}

export function rememberPicture(tabId: string): Promise<void> {
  return remember(tabId);
}

function remember(tabId: string): Promise<void> {
  if (isIncognitoProfile(useBrowser.getState().tabs[tabId]?.profileId ?? "")) return Promise.resolve();
  const view = webviews.get(tabId);
  if (!view) return Promise.resolve();
  return view
    .capturePicture(0.25)
    .then((picture) => {
      if (!picture || !useBrowser.getState().tabs[tabId]) return;
      pictures.delete(tabId);
      pictures.set(tabId, picture);
      for (const old of pictures.keys()) {
        if (pictures.size <= KEEP) break;
        pictures.delete(old);
      }
    })
    .catch(() => {});
}

export function startTabPictures() {
  if (started) return;
  started = true;
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    for (const [windowId, timer] of timers)
      if (!s.windows[windowId]) {
        clearTimeout(timer);
        timers.delete(windowId);
      }
    for (const w of Object.values(s.windows)) {
      const id = w.activeTabIds[w.profileId];
      if (!id || w.incognito) continue;
      const was = prev.windows[w.id];
      if (id === was?.activeTabIds[was.profileId] && s.tabs[id]?.url === prev.tabs[id]?.url) continue;
      if (isIncognitoProfile(s.tabs[id]?.profileId ?? "")) continue;
      clearTimeout(timers.get(w.id));
      timers.set(
        w.id,
        setTimeout(() => {
          timers.delete(w.id);
          const now = useBrowser.getState().windows[w.id];
          if (now?.activeTabIds[now.profileId] === id) remember(id);
        }, SETTLE_MS),
      );
    }
    if (s.tabs !== prev.tabs) for (const id of pictures.keys()) if (!s.tabs[id]) pictures.delete(id);
  });
}
