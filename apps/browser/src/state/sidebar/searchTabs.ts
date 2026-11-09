import { useBrowser, type BrowserState } from "../browser/store";
import { tabTitle } from "../browser/model";
import type { Tab } from "../browser/types";
import { isPeekTab } from "../peek/peek";
import { sharedTabsIn, sharesTabs } from "../tabs/tabShare";

export type Row =
  | { kind: "tab"; id: string; title: string; url: string; favicon: string | null; icon: string | null; where: string | null; current: boolean }
  | { kind: "closed"; id: string; title: string; url: string; favicon: string | null; icon: string | null; detail: string };

function candidates(s: BrowserState, windowId: string): { open: Row[]; closed: Row[] } {
  const w = s.windows[windowId];
  if (!w) return { open: [], closed: [] };
  const profileId = w.profileId;
  const shared = sharesTabs(s) ? sharedTabsIn(s.tabs, windowId) : null;
  const lastUsed = (t: Tab) => shared?.lastUsed(t) ?? t.lastActiveAt;
  const windowNumber = (id: string) => s.windowOrder.filter((x) => s.windows[x]?.kind !== "private" || x === windowId).indexOf(id) + 1;
  const open: Row[] = Object.values(s.tabs)
    .filter((t) => t.profileId === profileId && !isPeekTab(s, t.id) && !shared?.elsewhere(t))
    .sort((a, b) => lastUsed(b) - lastUsed(a))
    .map((t) => ({
      kind: "tab",
      id: t.id,
      title: tabTitle(t),
      url: t.url,
      favicon: t.favicon,
      icon: t.customIcon,
      where: t.windowId === windowId ? null : `Window ${windowNumber(t.windowId)}`,
      current: s.windows[t.windowId]?.activeTabIds[profileId] === t.id,
    }));
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
  return { open, closed };
}

export const searchCandidates = (windowId: string) => candidates(useBrowser.getState(), windowId);
