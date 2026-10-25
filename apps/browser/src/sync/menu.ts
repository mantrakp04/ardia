import type { MenuItem } from "@ardia/shell";
import { switchToTab } from "../lib/actions";
import { showToast } from "../components/layout/splitActions";
import { useBrowser } from "../store/browser";
import { plural } from "../store/model";
import type { Tab } from "../store/types";
import type { DeviceKind } from "./adapters";
import { onTabsReceived, sendTab, sendTargets, useSync, type ReceivedTab, type RemoteTabs } from "./engine";

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

const deviceKind = (name: string) => name.split(/[’']s /).slice(1).join("'s ").trim() || name;

export const deviceLabel = (kind: DeviceKind, name: string) => (kind === "phone" ? "iPhone" : deviceKind(name));

export function deviceSymbol(kind: DeviceKind, name: string): string {
  if (kind === "phone") return "iphone";
  return /\b(iMac|Mac mini|Mac Studio|Mac Pro)\b/i.test(name) ? "desktopcomputer" : "laptopcomputer";
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

function showReceivedTabs(received: ReceivedTab[]) {
  const byWindow = new Map<string, ReceivedTab[]>();
  for (const r of received) byWindow.set(r.windowId, [...(byWindow.get(r.windowId) ?? []), r]);
  for (const [windowId, tabs] of byWindow) {
    const last = tabs[tabs.length - 1]!;
    const labels = new Set(tabs.map((r) => deviceLabel(r.from.kind, r.from.name)));
    const from = labels.size === 1 ? [...labels][0]! : "Your Devices";
    const title = tabs.length === 1 ? `Tab from ${from}` : `${plural(tabs.length, "Tab")} from ${from}`;
    const message = tabs.length === 1 ? last.send.t || hostOf(last.send.u) : undefined;
    const icon = labels.size === 1 ? deviceSymbol(last.from.kind, last.from.name) : "macbook.and.iphone";
    showToast(windowId, title, message, { icon, action: { title: "Show", run: () => switchToTab(last.tabId) } });
  }
}

const hostOf = (url: string) => /^https?:\/\/(?:www\.)?([^/?#:]+)/i.exec(url)?.[1] ?? url;

onTabsReceived(showReceivedTabs);
