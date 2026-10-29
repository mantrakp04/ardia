import { cleanUrl, markdownLink } from "@ardia/core";
import { copyText } from "../../platform/clipboard";
import type { MenuItem } from "../../platform/menus";
import { withOptionAlternate, type MenuEntry } from "../app/menuSections";
import { openLinks, openUrl, type OpenAllMode } from "./actions";

export type Link = { url: string; title?: string | null };

export const OPEN_SYMBOLS = { tab: "plus.app", window: "macwindow.badge.plus", incognito: "eyeglasses", split: "rectangle.split.2x1" } as const;

export function openLinkItems({ split = true }: { split?: boolean } = {}): MenuItem[] {
  return [
    { id: "tab", title: "Open in New Tab", symbol: OPEN_SYMBOLS.tab },
    { id: "window", title: "Open in New Window", symbol: OPEN_SYMBOLS.window },
    { id: "incognito", title: "Open in Incognito Window", symbol: OPEN_SYMBOLS.incognito },
    ...(split ? [{ id: "split", title: "Open in Split View", symbol: OPEN_SYMBOLS.split }] : []),
  ];
}

export function openAllItems(links: number, label: "All" | number = "All"): MenuItem[] {
  const what = label === "All" ? "All" : String(label);
  return [
    { id: "openAll", title: `Open ${what} in New ${label === 1 ? "Tab" : "Tabs"}`, symbol: OPEN_SYMBOLS.tab, enabled: links > 0 },
    { id: "openAllWindow", title: `Open ${what} in New Window`, symbol: OPEN_SYMBOLS.window, enabled: links > 0 },
    { id: "openAllIncognito", title: `Open ${what} in Incognito Window`, symbol: OPEN_SYMBOLS.incognito, enabled: links > 0 },
  ];
}

export function copyLinkItems(count = 1): MenuEntry[] {
  const n = count === 1 ? "Link" : `${count} Links`;
  return withOptionAlternate(
    { id: "copy", title: `Copy ${n}`, symbol: "link", enabled: count > 0 },
    { id: "copyMarkdown", title: `Copy ${n} as Markdown`, symbol: "link", enabled: count > 0 },
  );
}

const OPEN_ALL_MODES: Record<string, OpenAllMode> = { openAll: "tabs", openAllWindow: "window", openAllIncognito: "incognito" };

export const openAllModeOf = (id: string): OpenAllMode | undefined => OPEN_ALL_MODES[id];
const OPEN_ONE_MODES = { tab: "foreground", window: "window", incognito: "incognito", split: "split" } as const;

export function runLinkChoice(choice: string | null, links: Link[], windowId: string, manyMessage?: string): boolean {
  if (!choice) return false;
  const one = links.length === 1 ? links[0] : undefined;
  if (one && choice in OPEN_ONE_MODES) {
    openUrl(one.url, windowId, OPEN_ONE_MODES[choice as keyof typeof OPEN_ONE_MODES]);
    return true;
  }
  if (choice in OPEN_ALL_MODES) {
    void openLinks(links, windowId, OPEN_ALL_MODES[choice], manyMessage);
    return true;
  }
  if (choice === "copy" || choice === "copyMarkdown") {
    copyLinks(links, choice === "copyMarkdown");
    return true;
  }
  return false;
}

export function copyLinks(links: Link[], markdown: boolean) {
  if (!links.length) return;
  const lines = links.map((l) => (markdown ? markdownLink(l.title || l.url, l.url) : cleanUrl(l.url)));
  copyText(markdown && lines.length > 1 ? lines.map((l) => `- ${l}`).join("\n") : lines.join("\n"));
}
