import { useBrowser, type BrowserState } from "../browser/store";
import type { Settings } from "../settings/settings";
import { everySlowly } from "../../platform/slowTimers";
import { webviews } from "../../platform/webviews";
import { withDeadline } from "../../lib/deadline";
import { tabEngine } from "../engines/engines";
import { isPlaying, useMedia } from "../media/media";
import { withSharedFamily } from "../pins/pinShare";
import { withPinnedPanes } from "../splits/splits";
import { hasPage } from "./pageSession";
import { usePages } from "./pageState";
import { shownTabIds } from "./shownTabs";
import { isSleeping } from "./sleepingTabs";
import { noteTabSleptOverCap } from "../telemetry/tabSleepCounts";

const LOADED_TABS: Record<Settings["memorySaverMode"], number> = { moderate: 20, balanced: 10, maximum: 5 };
const SWEEP_MS = 60_000;
const HIDDEN_FOR_MS = 60_000;

const PAGE_IS_BUSY = `(() => {
  const fields = Array.from(document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"));
  const firstSelected = (f) => { const o = Array.from(f.options); const i = o.findLastIndex((x) => x.defaultSelected); return i >= 0 || f.size > 1 ? i : o.findIndex((x) => !x.disabled); };
  const changed = (f) => f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked : f.tagName === "SELECT" ? (f.multiple ? Array.from(f.options).some((o) => o.selected !== o.defaultSelected) : f.selectedIndex !== firstSelected(f)) : f.value !== f.defaultValue;
  const touchedEditor = !!(navigator.userActivation && navigator.userActivation.hasBeenActive) && (document.designMode === "on" || !!document.querySelector("iframe, frame, [contenteditable]:not([contenteditable=false])"));
  const playing = Array.from(document.querySelectorAll("video, audio")).some((m) => !m.paused && !m.ended);
  const notifies = typeof Notification !== "undefined" && Notification.permission === "granted";
  post("result", JSON.stringify(fields.some(changed) || touchedEditor || playing || notifies || document.contentType === "application/pdf"));
})()`;

const SCHEME = /^[a-z][\w+.-]*:\/\//i;

export function isKeptSite(url: string, sites: string[]): boolean {
  const bare = url.replace(SCHEME, "").toLowerCase();
  const host = bare.replace(/[:/?#].*$/, "");
  return sites.some((site) => {
    const rule = site.replace(SCHEME, "").toLowerCase();
    if (rule.startsWith("[*.]")) return host === rule.slice(4) || host.endsWith(`.${rule.slice(4)}`);
    return host === rule || bare === rule || bare.startsWith(rule.endsWith("/") ? rule : `${rule}/`) || bare.startsWith(`${rule}?`);
  });
}

function inUse(s: BrowserState, id: string): boolean {
  const media = useMedia.getState();
  const access = usePages.getState().pages[id]?.mediaAccess;
  return (
    !!s.live[id]?.playingAudio ||
    !!media.pipOpen[id] ||
    isPlaying(media.sessions[id]) ||
    !!(access && (access.camera || access.microphone || access.screen)) ||
    !!media.tabShares[id] ||
    Object.values(media.tabShares).some((share) => share.capturedTabId === id)
  );
}

export function tabsOverCap(s: BrowserState, loaded: string[], seenAt: ReadonlyMap<string, number>, now: number): string[] {
  if (s.settings.memorySaver === false) return [];
  const cap = LOADED_TABS[s.settings.memorySaverMode] ?? LOADED_TABS.balanced;
  const awake = loaded.filter((id) => s.tabs[id] && hasPage(s.tabs[id]!) && !isSleeping(id));
  if (awake.length <= cap) return [];
  const shown = new Set(withSharedFamily(s, withPinnedPanes(s, [...shownTabIds(s)])));
  const hidden = awake.filter((id) => !shown.has(id));
  const lastSeen = (id: string) => Math.max(s.tabs[id]!.lastActiveAt, seenAt.get(id) ?? 0);
  return hidden
    .sort((a, b) => lastSeen(b) - lastSeen(a))
    .slice(Math.max(0, cap - (awake.length - hidden.length)))
    .filter((id) => {
      const t = s.tabs[id]!;
      return (
        tabEngine(s, id) === "chromium" &&
        /^https?:\/\//i.test(t.url) &&
        now - lastSeen(id) >= HIDDEN_FOR_MS &&
        !inUse(s, id) &&
        !isKeptSite(t.url, s.settings.keepActiveSites)
      );
    });
}

export function noteLeftShown(seenAt: Map<string, number>, s: BrowserState, prev: BrowserState, now: number) {
  if (s.windows === prev.windows && s.peeks === prev.peeks && s.splits === prev.splits && s.tabs === prev.tabs) return;
  const shown = shownTabIds(s);
  for (const id of shownTabIds(prev)) if (!shown.has(id)) seenAt.set(id, now);
}

let started = false;

export function startLoadedTabCap() {
  if (started) return;
  started = true;
  const seenAt = new Map<string, number>();
  let running = false;
  useBrowser.subscribe((s, prev) => noteLeftShown(seenAt, s, prev, Date.now()));

  const sweep = async () => {
    const s = useBrowser.getState();
    const now = Date.now();
    for (const id of shownTabIds(s)) seenAt.set(id, now);
    for (const id of seenAt.keys()) if (!s.tabs[id]) seenAt.delete(id);
    const over = tabsOverCap(s, [...webviews.keys()], seenAt, now);
    if (running || !over.length) return;
    running = true;
    try {
      for (const id of over) {
        const view = webviews.get(id);
        if (!view || (await withDeadline(view.evaluate<boolean>(PAGE_IS_BUSY), 1500, true)) !== false) continue;
        if (!tabsOverCap(useBrowser.getState(), [...webviews.keys()], seenAt, Date.now()).includes(id)) continue;
        if ((await view.discard().catch(() => "refused")) === "discarded") noteTabSleptOverCap();
      }
    } finally {
      running = false;
    }
  };

  everySlowly({ every: SWEEP_MS, run: () => void sweep() });
}
