import { confirm, copyText, prompt, showMenu } from "../app/system";
import { createBoost, deleteBoost, resetBoost, setBoostEnabled, updateBoost } from "../boosts/actions";
import { closeBoostEditor, openBoostEditor } from "../boosts/editor";
import { boostMatchesHost } from "../boosts/match";
import { encodeBoost, shareLink } from "../boosts/share";
import { currentBoostsKey, loadBoosts } from "../boosts/store";
import type { Boost } from "../boosts/types";
import { currentTab } from "../browser/current";
import { isIncognitoProfile } from "../browser/model";
import { activate } from "../tabs/actions";

export type BoostTarget = { profileId: string; host: string };

export function boostTarget(tabId: string): BoostTarget | null {
  const tab = currentTab(tabId);
  if (!tab || tab.engine === "webkit" || isIncognitoProfile(tab.profileId) || !/^https?:/i.test(tab.url)) return null;
  try {
    return { profileId: tab.profileId, host: new URL(tab.url).hostname };
  } catch {
    return null;
  }
}

export const canBoostTab = (tabId: string) => boostTarget(tabId) !== null;

export function siteBoostsOfTab(tabId: string): Boost[] {
  const target = boostTarget(tabId);
  return target ? loadBoosts(currentBoostsKey(target.profileId)).filter((boost) => boostMatchesHost(boost, target.host)) : [];
}

export const hasActiveSiteBoosts = (tabId: string) => siteBoostsOfTab(tabId).some((boost) => boost.enabled);

export function newBoostForTab(windowId: string, tabId: string) {
  const target = boostTarget(tabId);
  if (!target) return;
  activate(tabId);
  openBoostEditor(windowId, tabId, createBoost(target.profileId, target.host).id);
}

export function editBoostForTab(windowId: string, tabId: string, boostId?: string) {
  const id = boostId ?? [...siteBoostsOfTab(tabId)].sort((a, b) => b.modified - a.modified)[0]?.id;
  if (id) {
    activate(tabId);
    openBoostEditor(windowId, tabId, id);
  } else newBoostForTab(windowId, tabId);
}

export function turnOffBoostsForSite(tabId: string) {
  const target = boostTarget(tabId);
  if (!target) return;
  for (const boost of siteBoostsOfTab(tabId)) if (boost.enabled) setBoostEnabled(target.profileId, boost.id, false);
}

export async function renameBoost(profileId: string, boost: Boost, windowId?: string) {
  const name = await prompt({ title: "Rename Boost", value: boost.name, placeholder: boost.domain, confirmTitle: "Rename", windowId });
  if (name?.trim()) updateBoost(profileId, boost.id, { name: name.trim() });
}

export async function resetBoostAfterConfirm(profileId: string, boost: Boost, windowId?: string) {
  const { confirmed } = await confirm({
    title: "Reset this Boost?",
    message: "Its colours, font, text settings, hidden elements and code are cleared.",
    confirmTitle: "Reset",
    destructive: true,
    windowId,
  });
  if (confirmed) resetBoost(profileId, boost.id);
}

export async function deleteBoostAfterConfirm(profileId: string, boost: Boost, windowId?: string) {
  const { confirmed } = await confirm({
    title: `Delete “${boost.name}”?`,
    message: "Deleting a Boost can't be undone.",
    confirmTitle: "Delete",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  if (windowId) closeBoostEditor(windowId);
  deleteBoost(profileId, boost.id);
}

export function copyShareCode(boost: Boost, link = false): boolean {
  const code = encodeBoost(boost);
  if (code) copyText(link ? shareLink(code) : code);
  return code !== null;
}

export async function showBoostMenu(profileId: string, boost: Boost, windowId: string) {
  const choice = await showMenu([
    { id: "rename", title: "Rename…" },
    { id: "subdomains", title: "Include Subdomains", checked: boost.subdomains },
    { separator: true },
    { id: "share", title: "Copy Share Code", enabled: !boost.js.trim() },
    { separator: true },
    { id: "reset", title: "Reset…" },
    { id: "delete", title: "Delete…" },
  ]);
  if (choice === "rename") await renameBoost(profileId, boost, windowId);
  else if (choice === "subdomains") updateBoost(profileId, boost.id, { subdomains: !boost.subdomains });
  else if (choice === "share") copyShareCode(loadBoosts(profileId).find((b) => b.id === boost.id) ?? boost);
  else if (choice === "reset") await resetBoostAfterConfirm(profileId, boost, windowId);
  else if (choice === "delete") await deleteBoostAfterConfirm(profileId, boost, windowId);
}
