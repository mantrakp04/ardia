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

export const PAGE_IS_BUSY = `(() => {
  const all = [];
  const walk = (root) => { for (const el of root.querySelectorAll("*")) { all.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  const is = (el, ...names) => names.includes(el.localName);
  const isField = (el) => is(el, "textarea", "select") || (is(el, "input") && !["hidden", "submit", "button"].includes(el.type));
  const firstSelected = (f) => { const o = Array.from(f.options); const i = o.findLastIndex((x) => x.defaultSelected); return i >= 0 || f.size > 1 ? i : o.findIndex((x) => !x.disabled); };
  const changed = (f) => f.type === "checkbox" || f.type === "radio" ? f.checked !== f.defaultChecked : is(f, "select") ? (f.multiple ? Array.from(f.options).some((o) => o.selected !== o.defaultSelected) : f.selectedIndex !== firstSelected(f)) : f.value !== f.defaultValue;
  const interacted = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  const editor = document.designMode === "on" || all.some((el) => is(el, "iframe", "frame") || el.isContentEditable);
  const playing = all.some((el) => is(el, "video", "audio") && !el.paused && !el.ended);
  const notifies = typeof Notification !== "undefined" && Notification.permission === "granted";
  post("result", JSON.stringify(all.some((el) => isField(el) && changed(el)) || (interacted && editor) || playing || notifies || document.contentType === "application/pdf"));
})()`;

const siteParts = (url: string): [string, string] => {
  const [, host = "", rest = ""] = /^(?:[a-z][\w+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(url.trim()) ?? [];
  return [host.toLowerCase(), `${host.toLowerCase()}${rest}`];
};

export function isKeptSite(url: string, sites: string[]): boolean {
  const [host, bare] = siteParts(url);
  return sites.some((site) => {
    const [ruleHost, rule] = siteParts(site);
    if (ruleHost.startsWith("[*.]")) return host === ruleHost.slice(4) || host.endsWith(`.${ruleHost.slice(4)}`);
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

export function tabsOverCap(s: BrowserState, loaded: string[], seenAt: ReadonlyMap<string, number>, now: number, skip: ReadonlySet<string> = new Set()): string[] {
  if (s.settings.memorySaver === false) return [];
  const cap = LOADED_TABS[s.settings.memorySaverMode] ?? LOADED_TABS.balanced;
  const awake = loaded.filter((id) => s.tabs[id] && hasPage(s.tabs[id]!) && !isSleeping(id));
  if (awake.length <= cap) return [];
  const shown = new Set(withSharedFamily(s, withPinnedPanes(s, [...shownTabIds(s)])));
  const lastSeen = (id: string) => Math.max(s.tabs[id]!.lastActiveAt, seenAt.get(id) ?? 0);
  return awake
    .filter((id) => {
      const t = s.tabs[id]!;
      return (
        !shown.has(id) &&
        !skip.has(id) &&
        tabEngine(s, id) === "chromium" &&
        /^https?:\/\//i.test(t.url) &&
        now - lastSeen(id) >= HIDDEN_FOR_MS &&
        !inUse(s, id) &&
        !isKeptSite(t.url, s.settings.keepActiveSites)
      );
    })
    .sort((a, b) => lastSeen(a) - lastSeen(b))
    .slice(0, awake.length - cap);
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
    if (running) return;
    running = true;
    const busy = new Set<string>();
    const slept = new Set<string>();
    const loaded = () => [...webviews.keys()].filter((id) => !slept.has(id));
    try {
      for (let id = tabsOverCap(s, loaded(), seenAt, now, busy)[0]; id; id = tabsOverCap(useBrowser.getState(), loaded(), seenAt, Date.now(), busy)[0]) {
        const view = webviews.get(id);
        if (!view || (await withDeadline(view.evaluate<boolean>(PAGE_IS_BUSY), 1500, true)) !== false) {
          busy.add(id);
          continue;
        }
        if (!tabsOverCap(useBrowser.getState(), loaded(), seenAt, Date.now(), busy).includes(id)) {
          busy.add(id);
          continue;
        }
        if ((await view.discard().catch(() => "refused")) === "discarded") {
          slept.add(id);
          noteTabSleptOverCap();
        } else busy.add(id);
      }
    } finally {
      running = false;
    }
  };

  everySlowly({ every: SWEEP_MS, run: () => void sweep() });
}
