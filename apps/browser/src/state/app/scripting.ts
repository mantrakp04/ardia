import { cleanUrl } from "@ardia/core";
import { onScriptCommand, replyToScript, setScriptState, type ScriptCommand, type ScriptState } from "../../platform/scripting";
import { copyText } from "../../platform/clipboard";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, resolveWindowId, viewTabIds, windowTitle } from "../browser/model";
import { focus, openWindow, switchProfile, switchToTab } from "../browser/actions";
import { windowForProfile } from "../littleArdia/linkRoutes";
import { focusedWindowOf } from "../windows/ui";
import { JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED, runsJavaScript } from "../settings/scriptUrls";
import { webviews } from "../../platform/webviews";
import { errorText } from "../../lib/errors";

function scriptState(s: BrowserState): ScriptState {
  const tabInfo = (tabId: string) => {
    const t = s.tabs[tabId]!;
    return { id: tabId, profileId: t.profileId, title: t.customTitle || t.title, url: t.url, loading: !!s.live[tabId]?.isLoading, pinned: t.pinned };
  };
  return {
    windows: s.windowOrder.map((id) => {
      const w = s.windows[id]!;
      const shown = viewTabIds(s, id);
      return {
        id,
        title: windowTitle(s, id),
        profileId: w.profileId,
        incognito: w.incognito,
        activeTabId: activeTabId(s, id) ?? null,
        tabs: shown.map(tabInfo),
        otherProfilesTabs: w.tabIds.filter((tabId) => s.tabs[tabId] && !shown.includes(tabId)).map(tabInfo) };
    }),
    profiles: s.profileOrder.map((id) => ({ id, name: s.profiles[id]!.name })) };
}

export function startScripting() {
  let lastJson = "";
  const push = () => {
    const state = scriptState(useBrowser.getState());
    const json = JSON.stringify(state);
    if (json === lastJson) return Promise.resolve();
    lastJson = json;
    return setScriptState(state);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.windows === prev.windows && s.live === prev.live && s.profiles === prev.profiles) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      void push();
    }, 100);
  });
  void push();

  onScriptCommand((request) => {
    let result: Record<string, unknown> | null = null;
    Promise.resolve()
      .then(async () => {
        result = (await runScriptCommand(request)) ?? {};
      })
      .then(
        () => push().then(() => replyToScript(request.id, result)),
        (error: unknown) => push().then(() => replyToScript(request.id, null, errorText(error))),
      );
  });
}

async function runScriptCommand(request: ScriptCommand): Promise<Record<string, unknown> | void> {
  const s = useBrowser.getState();
  const tabOf = (tabId: string) => {
    const tab = s.tabs[tabId];
    if (!tab) throw new Error("That tab no longer exists.");
    return tab;
  };
  const loaded = (tabId: string) => {
    const web = webviews.get(tabId);
    if (!web) throw new Error("The tab hasn't loaded yet; focus it first.");
    return web;
  };
  const scriptJavaScriptAllowed = s.settings.allowJavaScriptFromAppleEvents;
  const refusesUrl = (url: string | undefined) => !!url && !scriptJavaScriptAllowed && runsJavaScript(url, s.settings);
  switch (request.command) {
    case "newWindow": {
      if (refusesUrl(request.url)) return JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED;
      const windowId = openWindow({ url: request.url, incognito: request.incognito, profileId: request.profileId });
      return { windowId };
    }
    case "newTab": {
      if (refusesUrl(request.url)) return JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED;
      const windowId = resolveWindowId(s, request.windowId);
      if (!windowId) {
        const created = openWindow({ url: request.url });
        return { windowId: created, tabId: activeTabId(useBrowser.getState(), created) };
      }
      const view = viewTabIds(s, windowId);
      const w = s.windows[windowId]!;
      let index: number | undefined;
      if (request.index !== undefined) {
        const pinned = view.filter((id) => s.tabs[id]!.pinned).length;
        const at = Math.max(request.index, pinned);
        index = at < view.length ? w.tabIds.indexOf(view[at]!) : w.tabIds.length;
      }
      const tabId = s.newTab(windowId, { url: request.url, index });
      return { windowId, tabId };
    }
    case "newTabInProfile": {
      if (!s.profiles[request.profileId]) throw new Error("That profile no longer exists.");
      const windowId = windowForProfile(request.profileId);
      if (!windowId) {
        const created = openWindow({ profileId: request.profileId });
        focus(created);
        return { windowId: created, tabId: activeTabId(useBrowser.getState(), created) };
      }
      const tabId = s.newTab(windowId, { profileId: request.profileId, newTabCommand: true });
      focus(windowId);
      return { windowId, tabId };
    }
    case "setURL":
      tabOf(request.tabId);
      if (refusesUrl(request.url)) return JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED;
      return s.navigate(request.tabId, request.url);
    case "closeTab":
      tabOf(request.tabId);
      return s.closeTab(request.tabId);
    case "closeTabs":
      if (request.tabIds.some((tabId) => !s.tabs[tabId])) throw new Error("That tab is closed.");
      return s.closeTabs(request.tabIds, { lastClosesWindow: true });
    case "closeWindow":
      if (!s.windows[request.windowId]) throw new Error("That window no longer exists.");
      return s.closeWindow(request.windowId);
    case "reload": {
      const tab = tabOf(request.tabId);
      const web = webviews.get(request.tabId);
      if (web) return void (await web.reload());
      if (tab.url) s.navigate(tab.id, tab.url);
      return;
    }
    case "back":
      tabOf(request.tabId);
      return void (await loaded(request.tabId).goBack());
    case "forward":
      tabOf(request.tabId);
      return void (await loaded(request.tabId).goForward());
    case "focusTab":
      tabOf(request.tabId);
      return switchToTab(request.tabId);
    case "copyLink": {
      const windowId = focusedWindowOf(s) ?? resolveWindowId(s, null);
      if (windowId && s.windows[windowId]?.incognito) throw new Error("The front window is private, so its link stays in it.");
      const tabId = windowId ? activeTabId(s, windowId) : undefined;
      if (!tabId) throw new Error("There's no tab open in Ardia.");
      const url = cleanUrl(s.tabs[tabId]!.url);
      if (!url) throw new Error("That tab has no link yet.");
      copyText(url);
      return { url };
    }
    case "setActiveTabIndex": {
      if (!s.windows[request.windowId]) throw new Error("That window no longer exists.");
      if (request.index < 1 || request.index > viewTabIds(s, request.windowId).length) throw new Error("There's no tab at that index.");
      return s.activateIndex(request.windowId, request.index - 1);
    }
    case "focusProfile": {
      const windowId = resolveWindowId(s, null);
      if (!s.profiles[request.profileId]) throw new Error("That profile no longer exists.");
      if (!windowId || s.windows[windowId]!.incognito) throw new Error("There's no window to show the profile in.");
      return switchProfile(windowId, request.profileId);
    }
    case "execute": {
      tabOf(request.tabId);
      if (!scriptJavaScriptAllowed) return JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED;
      const outcome = await loaded(request.tabId).evaluate<{ value?: string; error?: string }>(executeWrapper(request.code));
      if (!outcome) throw new Error("The page didn't answer.");
      if (outcome.error) throw new Error(outcome.error);
      return { value: outcome.value ?? "" };
    }
  }
}

function executeWrapper(code: string) {
  return `
const text = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { const json = JSON.stringify(v); return json === undefined ? String(v) : json; } catch { return String(v); }
};
let value;
try { value = (0, eval)(${JSON.stringify(code)}); } catch (e) { post("result", JSON.stringify({ error: String(e) })); return; }
Promise.resolve(value).then(
  (v) => post("result", JSON.stringify({ value: text(v) })),
  (e) => post("result", JSON.stringify({ error: String(e) })),
);`;
}
