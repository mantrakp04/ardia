import { classifyPaste, markdownLink, sanitizePaste, searchUrl, type PasteAction } from "@ardia/core";
import { copyText, readText } from "../../platform/clipboard";
import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections, withOptionAlternate, type MenuKey } from "../app/menuSections";
import { currentSettings } from "../browser/current";
import { menuShortcut } from "../commands/commandShortcuts";
import { navigate } from "../tabs/actions";
import { defaultSearchEngine } from "../settings/settings";
import { canShare, shareTab } from "../site/share";
import { copyPageUrl } from "../site/selection";
import type { Tab } from "../browser/types";

export async function clipboardPasteAction(): Promise<PasteAction | null> {
  return classifyPaste(await readText());
}

export function pasteMenuItem(action: PasteAction | null): MenuItem[] {
  if (!action) return [];
  return [{ id: "pasteAndGo", title: action.kind === "go" ? "Paste and Go" : "Paste and Search", symbol: action.kind === "go" ? "arrow.right.circle" : "magnifyingglass" }];
}

export function pasteTarget(action: PasteAction): string {
  return action.kind === "go" ? action.url : searchUrl(defaultSearchEngine(currentSettings()), action.query);
}

type Keys = (command: string) => MenuKey;

export function urlBarMenuItems({ paste, shareable, keys = menuShortcut }: { paste: PasteAction | null; shareable: boolean; keys?: Keys }): MenuItem[] {
  return menuSections(
    [
      ...withOptionAlternate(
        { id: "copy", title: "Copy Link", symbol: "link" },
        { id: "copyMarkdown", title: "Copy Link as Markdown", symbol: "link" },
        { primary: keys("copyUrl"), alternate: keys("copyUrlAsMarkdown") },
      ),
      ...pasteMenuItem(paste),
    ],
    [shareable && { id: "share", title: "Share", symbol: "square.and.arrow.up", share: true }],
  );
}

export async function showUrlBarMenu(tab: Pick<Tab, "id" | "url" | "title" | "windowId"> & Partial<Pick<Tab, "customTitle">>) {
  const action = await clipboardPasteAction();
  const choice = await showMenu(urlBarMenuItems({ paste: action, shareable: canShare(tab) }));
  if (choice === "pasteAndGo" && action) navigate(tab.id, pasteTarget(action));
  if (choice === "copy") void copyPageUrl(tab.id);
  if (choice === "copyMarkdown") copyText(markdownLink(tab.customTitle || tab.title, tab.url));
  if (choice?.startsWith("share:via:")) void shareTab({ url: tab.url, title: tab.title, customTitle: tab.customTitle ?? null }, tab.windowId, choice.slice("share:via:".length));
}

const EDIT_KEYS = { cut: "x", copy: "c", paste: "v", selectAll: "a" } as const;
const editItem = (id: keyof typeof EDIT_KEYS, title: string, enabled: boolean): MenuItem => ({ id, title, enabled, key: EDIT_KEYS[id], modifiers: ["command"] });

export function fieldMenuItems({ paste, hasSelection, hasText }: { paste: PasteAction | null; hasSelection: boolean; hasText: boolean }): MenuItem[] {
  return menuSections(
    pasteMenuItem(paste),
    [editItem("cut", "Cut", hasSelection), editItem("copy", "Copy", hasSelection), editItem("paste", "Paste", !!paste)],
    [editItem("selectAll", "Select All", hasText)],
  );
}

export type FieldMenuPick = { kind: "go"; url: string } | { kind: "edit"; text: string; caret: number } | { kind: "selectAll" } | null;

export async function showFieldMenu(value: string, selection: { current: { start: number; end: number } }): Promise<FieldMenuPick> {
  const paste = await clipboardPasteAction();
  const { start, end } = selection.current;
  const choice = await showMenu(fieldMenuItems({ paste, hasSelection: end > start, hasText: !!value }));
  if (choice === "pasteAndGo" && paste) return { kind: "go", url: pasteTarget(paste) };
  if (choice === "copy" || choice === "cut") copyText(value.slice(start, end));
  if (choice === "cut" || choice === "paste") {
    const insert = choice === "paste" ? sanitizePaste(await readText()) : "";
    return { kind: "edit", text: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
  }
  if (choice === "selectAll") return { kind: "selectAll" };
  return null;
}
