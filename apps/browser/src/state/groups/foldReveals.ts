import type { BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { rootOf } from "./groupNesting";

export const hasLivePage = (t: Tab | undefined) => !!(t && (t.navigation || t.adoptId || t.pageIn));

export function settleRevealed(s: BrowserState, prev: BrowserState): Partial<BrowserState> | null {
  if (s.windows === prev.windows && s.groups === prev.groups && s.tabs === prev.tabs) return null;
  let revealed = s.revealedInFold;
  const edit = () => (revealed === s.revealedInFold ? (revealed = { ...revealed }) : revealed);
  for (const [groupId, ids] of Object.entries(s.revealedInFold)) {
    const g = s.groups[groupId];
    const pinned = !!(g && rootOf(s.groups, groupId)?.pinned);
    const kept = g?.collapsed ? ids.filter((id) => s.tabs[id] && g.tabIds.includes(id) && (!pinned || hasLivePage(s.tabs[id]))) : [];
    if (kept.length === ids.length) continue;
    if (kept.length) edit()[groupId] = kept;
    else delete edit()[groupId];
  }
  const reveal = (id: string, opened = false) => {
    for (const g of Object.values(s.groups)) {
      if (!g.collapsed || !g.tabIds.includes(id) || (opened && rootOf(s.groups, g.id)?.pinned)) continue;
      const shown: string[] = revealed[g.id] ?? [];
      if (!shown.includes(id)) edit()[g.id] = [...shown, id];
    }
  };
  if (s.tabs !== prev.tabs) {
    for (const t of Object.values(s.tabs)) if (!prev.tabs[t.id] && prev.windows[t.windowId]) reveal(t.id, true);
  }
  for (const w of Object.values(s.windows)) {
    const before = prev.windows[w.id];
    const id = w.activeTabIds[w.profileId];
    const was = before?.activeTabIds[before.profileId];
    if (!before || !id || was === id || (was && s.tabs[id]?.pageIn === was)) continue;
    reveal(id);
  }
  return revealed === s.revealedInFold ? null : { revealedInFold: revealed };
}

export function revealedTabs(s: BrowserState, groupId: string): string[] {
  const ids = s.revealedInFold[groupId];
  if (!ids?.length) return [];
  const pinned = !!rootOf(s.groups, groupId)?.pinned;
  return ids.filter((id) => (pinned ? hasLivePage(s.tabs[id]) : !!s.tabs[id]));
}
