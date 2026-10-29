import { onAppEvent } from "../../platform/app";
import { onWindowEvent } from "../../platform/windows";
import { webviews } from "../../platform/webviews";
import { startLive } from "../live";
import { startAutoCleanUp } from "../pins/autoCleanUp";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { isSilenced } from "../tabs/mute";
import { dismissHover } from "../sidebar/hover";
import { sidebarUi } from "../sidebar/sidebarUi";
import { cancelSwitcher, commitSwitcher, moveSwitcher } from "../sidebar/switcher";

let started = false;

export function startSidebarEffects() {
  if (started) return;
  started = true;
  startLive();

  useBrowser.subscribe((s, prev) => {
    const switcher = sidebarUi().switcher;
    if (switcher && s.windows !== prev.windows && !s.windows[switcher.windowId]) cancelSwitcher();
    const sitesChanged = s.settings.mutedSites !== prev.settings.mutedSites || s.privateSiteMutes !== prev.privateSiteMutes;
    for (const id of sitesChanged ? Object.keys(s.tabs) : changedIds(s.tabs, prev.tabs)) {
      const tab = s.tabs[id];
      const was = prev.tabs[id];
      if (!tab || !was || (!sitesChanged && tab.url === was.url && tab.muted === was.muted)) continue;
      const silenced = isSilenced(s, tab);
      if (silenced !== isSilenced(prev, was)) void webviews.get(id)?.setMuted(silenced);
    }
  });

  onAppEvent((e) => {
    if (e.type === "resignActive" || e.type === "screenLocked") {
      dismissHover();
      useBrowser.getState().closeAbandonedNewTabs();
    }
    if (e.type === "switcherReleased" || e.type === "resignActive") commitSwitcher();
    if (e.type === "switcherMouseUp" || (e.type === "switcherKey" && e.key === "escape")) cancelSwitcher();
    if (e.type === "switcherKey" && e.key !== "escape") moveSwitcher(e.key === "next" ? 1 : -1);
  });

  onWindowEvent((e) => {
    const hover = sidebarUi().hover;
    if (e.type === "focus" && hover && hover.windowId !== e.id) dismissHover();
  });

  startAutoCleanUp();
}
