import { useBrowser, type BrowserState } from "../browser/store";
import { tabTitle } from "../browser/model";
import type { Tab } from "../browser/types";
import { isPeekTab } from "../peek/peek";
import { sharedTabsIn, sharesTabs } from "../tabs/tabShare";
import { inOtherProfile, searchesAllProfiles } from "../tabs/tabsInAllProfiles";

export type Row =
  | { kind: "tab"; id: string; title: string; url: string; favicon: string | null; icon: string | null; where: string | null; current: boolean }
  | { kind: "closed"; id: string; title: string; url: string; favicon: string | null; icon: string | null; detail: string };

function candidates(s: BrowserState, windowId: string): { open: Row[]; elsewhere: Row[]; closed: Row[] } {
  const w = s.windows[windowId];
  if (!w) return { open: [], elsewhere: [], closed: [] };
  const profileId = w.profileId;
  const shared = sharesTabs(s) ? sharedTabsIn(s.tabs, windowId) : null;
  const lastUsed = (t: Tab) => shared?.lastUsed(t) ?? t.lastActiveAt;
  const windowNumber = (id: string) => s.windowOrder.filter((x) => s.windows[x]?.kind !== "private" || x === windowId).indexOf(id) + 1;
  const windowLabel = (t: Tab) => (t.windowId === windowId ? null : `Window ${windowNumber(t.windowId)}`);
  const tabRow = (t: Tab, where: string | null, current: boolean): Row => ({ kind: "tab", id: t.id, title: tabTitle(t), url: t.url, favicon: t.favicon, icon: t.customIcon, where, current });
  const other = searchesAllProfiles(s.settings.searchTabsInAllProfiles, profileId) ? inOtherProfile(profileId) : () => false;
  const listed = Object.values(s.tabs)
    .filter((t) => (t.profileId === profileId || other(t)) && !isPeekTab(s, t.id) && !shared?.elsewhere(t))
    .sort((a, b) => lastUsed(b) - lastUsed(a));
  const open = listed.filter((t) => t.profileId === profileId).map((t) => tabRow(t, windowLabel(t), s.windows[t.windowId]?.activeTabIds[profileId] === t.id));
  const elsewhere = listed.filter(other).map((t) => tabRow(t, [s.profiles[t.profileId]?.name, windowLabel(t)].filter(Boolean).join(" · "), false));
  const closed: Row[] = [
    ...s.closedTabs
      .filter((c) => c.tab.profileId === profileId)
      .map((c) => ({ kind: "closed" as const, id: c.id, title: tabTitle(c.tab), url: c.tab.url, favicon: c.tab.favicon, icon: c.tab.customIcon, detail: "", at: c.closedAt })),
    ...s.closedGroups.map((c) => ({
      kind: "closed" as const,
      id: c.id,
      title: c.group.name,
      url: c.tabs[0]?.url ?? "",
      favicon: c.tabs[0]?.favicon ?? null,
      icon: c.group.icon,
      detail: c.tabs.length === 1 ? "Group · 1 tab" : `Group · ${c.tabs.length} tabs`,
      at: c.closedAt,
    })),
  ]
    .sort((a, b) => b.at - a.at)
    .map(({ at: _, ...row }) => row);
  return { open, elsewhere, closed };
}

export const searchCandidates = (windowId: string) => candidates(useBrowser.getState(), windowId);
