import type { MenuItem } from "../../platform/menus";
import { useBrowser } from "../browser/store";
import type { Tab } from "../browser/types";
import { deviceLabel, deviceSymbol } from "./devices";
import { sendTab, sendTargets, useSync } from "./engine";
import type { RemoteTabs } from "./syncDoc";

export function syncedDevicesMenuItem(profileId: string): MenuItem | null {
  const devices = useSync.getState().remoteTabs[profileId] ?? [];
  if (!devices.length) return null;
  const tabs = (d: RemoteTabs): MenuItem[] => [
    { id: "synced-header", title: "Recent Tabs", enabled: false },
    ...d.tabs.map((t, i) => ({ id: `synced:${d.deviceId}:${i}`, title: t.title || t.url })),
  ];
  if (devices.length === 1) {
    const d = devices[0]!;
    return { id: "synced", title: `Your ${deviceLabel(d.kind, d.name)} Tabs`, symbol: deviceSymbol(d.kind, d.name), children: tabs(d) };
  }
  return {
    id: "synced",
    title: "Your Devices",
    symbol: "macbook.and.iphone",
    children: devices.map((d) => ({ id: `device:${d.deviceId}`, title: d.name, symbol: deviceSymbol(d.kind, d.name), children: tabs(d) })),
  };
}

export function openSyncedTab(choice: string, windowId: string, profileId: string): boolean {
  const match = /^synced:(.+):(\d+)$/.exec(choice);
  if (!match) return false;
  const device = useSync.getState().remoteTabs[profileId]?.find((d) => d.deviceId === match[1]);
  const tab = device?.tabs[Number(match[2])];
  if (tab) useBrowser.getState().newTab(windowId, { url: tab.url });
  return true;
}

const SEND_CHOICE = "sendTo:";

export function sendTabMenuItem(tab: Tab): MenuItem | null {
  const targets = /^https?:/i.test(tab.url) ? sendTargets(tab.profileId) : [];
  if (!targets.length) return null;
  if (targets.length === 1) {
    const d = targets[0]!;
    return { id: `${SEND_CHOICE}${d.id}`, title: `Send to ${d.name}`, symbol: deviceSymbol(d.kind, d.name) };
  }
  return {
    id: "sendToDevice",
    title: "Send to Device",
    symbol: "macbook.and.iphone",
    children: targets.map((d) => ({ id: `${SEND_CHOICE}${d.id}`, title: d.name, symbol: deviceSymbol(d.kind, d.name) })),
  };
}

export function sendTabFromMenu(choice: string, tab: Tab): boolean {
  if (!choice.startsWith(SEND_CHOICE)) return false;
  sendTab(tab.id, choice.slice(SEND_CHOICE.length));
  return true;
}
