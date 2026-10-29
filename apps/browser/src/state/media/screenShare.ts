import { changeCaptureSource, stopCapture, type DisplayMediaRequest } from "../../platform/media";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { usePages } from "../tabs/pageState";
import { useMedia, type TabShare } from "./media";

export { getDisplayMediaSources, type DisplayMediaAudio, type DisplayMediaSource } from "../../platform/media";

export function useShareFor(tabId: string): [string, TabShare] | null {
  const shares = useMedia((m) => m.tabShares);
  const profile = useBrowser((s) => {
    const tab = s.tabs[tabId];
    return tab && /^https?:|^file:/.test(tab.url) ? engineProfile(s, tab.profileId) : null;
  });
  const capturing = usePages((p) => Object.keys(shares).filter((id) => p.pages[id]?.mediaAccess?.screen).join(","));
  if (profile === null) return null;
  for (const capturer of capturing ? capturing.split(",") : []) {
    const share = shares[capturer];
    if (!share || share.dismissed[tabId]) continue;
    const owner = useBrowser.getState().tabs[capturer];
    if (owner && engineProfile(useBrowser.getState(), owner.profileId) === profile) return [capturer, share];
  }
  return null;
}

export function noteTabShare(capturerTabId: string, capturedTabId: string, origin: string) {
  useMedia.setState((m) => ({ tabShares: { ...m.tabShares, [capturerTabId]: { capturedTabId, origin, dismissed: {} } } }));
}

const SHARE_END_MS = 1500;

export function startTabShareCleanup() {
  return usePages.subscribe((p, prev) => {
    if (p.pages === prev.pages) return;
    const shares = useMedia.getState().tabShares;
    const ended = Object.keys(shares).filter((id) => prev.pages[id]?.mediaAccess?.screen && !p.pages[id]?.mediaAccess?.screen);
    if (!ended.length) return;
    setTimeout(() => {
      const gone = ended.filter((id) => !usePages.getState().pages[id]?.mediaAccess?.screen);
      if (!gone.length) return;
      useMedia.setState((m) => {
        const next = { ...m.tabShares };
        for (const id of gone) delete next[id];
        return { tabShares: next };
      });
    }, SHARE_END_MS);
  });
}

export async function shareInstead(capturer: string, tabId: string): Promise<boolean> {
  const ok = await changeCaptureSource(capturer, tabId);
  if (!ok) return false;
  useMedia.setState((m) => {
    const share = m.tabShares[capturer];
    return share ? { tabShares: { ...m.tabShares, [capturer]: { ...share, capturedTabId: tabId, dismissed: {} } } } : m;
  });
  return true;
}

if (__DEV__) (globalThis as { acShareBar?: unknown }).acShareBar = { shareInstead, tabShares: () => useMedia.getState().tabShares };

export const stopSharing = (capturer: string) => void stopCapture(capturer);

export function dismissShareBar(capturer: string, tabId: string) {
  useMedia.setState((m) => {
    const share = m.tabShares[capturer];
    return share ? { tabShares: { ...m.tabShares, [capturer]: { ...share, dismissed: { ...share.dismissed, [tabId]: true } } } } : m;
  });
}

export function shareableTabs(tabId: string) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab) return [];
  const profile = engineProfile(s, tab.profileId);
  const live = usePages.getState().ready;
  return Object.values(s.tabs)
    .filter((t) => !!live[t.id] && engineProfile(s, t.profileId) === profile && /^https?:|^file:/.test(t.url))
    .sort((a, b) => (a.id === tabId ? 1 : b.id === tabId ? -1 : b.lastActiveAt - a.lastActiveAt));
}

type Pending = DisplayMediaRequest & { pageUrl: string };

export function requestDisplayMedia(tabId: string, request: DisplayMediaRequest) {
  const pending = useMedia.getState().displayRequests[tabId];
  if (pending) void webviews.get(tabId)?.resolveDisplayMedia(pending.id, null);
  const pageUrl = useBrowser.getState().tabs[tabId]?.url ?? "";
  useMedia.setState((m) => ({ displayRequests: { ...m.displayRequests, [tabId]: { ...request, pageUrl } as Pending } }));
}

if (__DEV__)
  (globalThis as { acSharePicker?: unknown }).acSharePicker = {
    answerDisplayMedia: (tabId: string, sourceId: string | null, audio = false) => answerDisplayMedia(tabId, sourceId, audio),
    shareTab: (tabId: string, sharedTabId: string, audio = true) => shareTab(tabId, sharedTabId, audio),
  };

export function answerDisplayMedia(tabId: string, sourceId: string | null, audio = false) {
  const request = useMedia.getState().displayRequests[tabId];
  if (!request) return;
  void webviews.get(tabId)?.resolveDisplayMedia(request.id, sourceId, audio);
  useMedia.setState((m) => {
    const displayRequests = { ...m.displayRequests };
    delete displayRequests[tabId];
    return { displayRequests };
  });
}

export async function shareTab(tabId: string, sharedTabId: string, audio: boolean) {
  const request = useMedia.getState().displayRequests[tabId];
  if (!request) return;
  const source = await webviews.get(sharedTabId)?.mediaCaptureSourceId();
  if (useMedia.getState().displayRequests[tabId] !== request) return;
  if (source) noteTabShare(tabId, sharedTabId, request.origin);
  answerDisplayMedia(tabId, source ?? null, audio);
}

export function cancelDisplayMediaOnNavigation() {
  const page = (url: string) => url.replace(/#.*$/, "");
  return useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const [tabId, request] of Object.entries(useMedia.getState().displayRequests) as [string, Pending][]) {
      const url = s.tabs[tabId]?.url;
      if (url !== undefined && page(url) !== page(request.pageUrl)) answerDisplayMedia(tabId, null);
    }
  });
}
