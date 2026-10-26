import { classifyPaste, cleanUrl, sanitizePaste, searchUrl, type PasteAction } from "@ardia/core";
import { copyText, readClipboard } from "../../platform/clipboard";
import { showMenu, type MenuItem } from "../../platform/menus";
import { currentSettings } from "../browser/current";
import { navigate } from "../tabs/actions";
import { defaultSearchEngine } from "../settings/settings";
import type { Tab } from "../browser/types";

export async function clipboardPasteAction(): Promise<PasteAction | null> {
  return classifyPaste(await readClipboard());
}

export function pasteMenuItem(action: PasteAction | null): MenuItem[] {
  if (!action) return [];
  return [{ id: "pasteAndGo", title: action.kind === "go" ? "Paste and Go" : "Paste and Search", symbol: action.kind === "go" ? "arrow.right.circle" : "magnifyingglass" }];
}

export function pasteTarget(action: PasteAction): string {
  return action.kind === "go" ? action.url : searchUrl(defaultSearchEngine(currentSettings()), action.query);
}

export async function showUrlBarMenu(tab: Pick<Tab, "id" | "url">) {
  const action = await clipboardPasteAction();
  const paste = pasteMenuItem(action);
  const choice = await showMenu([
    ...paste,
    ...(paste.length ? [{ separator: true as const }] : []),
    { id: "copy", title: "Copy URL", symbol: "link" },
  ]);
  if (choice === "pasteAndGo" && action) navigate(tab.id, pasteTarget(action));
  if (choice === "copy") copyText(cleanUrl(tab.url));
}

export type FieldMenuPick = { kind: "go"; url: string } | { kind: "edit"; text: string; caret: number } | { kind: "selectAll" } | null;

export async function showFieldMenu(value: string, selection: { current: { start: number; end: number } }): Promise<FieldMenuPick> {
  const paste = await clipboardPasteAction();
  const { start, end } = selection.current;
  const hasSelection = end > start;
  const choice = await showMenu([
    ...pasteMenuItem(paste),
    ...(paste ? [{ separator: true as const }] : []),
    { id: "cut", title: "Cut", enabled: hasSelection },
    { id: "copy", title: "Copy", enabled: hasSelection },
    { id: "paste", title: "Paste", enabled: !!paste },
    { separator: true },
    { id: "selectAll", title: "Select All", enabled: !!value },
  ]);
  if (choice === "pasteAndGo" && paste) return { kind: "go", url: pasteTarget(paste) };
  if (choice === "copy" || choice === "cut") copyText(value.slice(start, end));
  if (choice === "cut" || choice === "paste") {
    const insert = choice === "paste" ? sanitizePaste(await readClipboard()) : "";
    return { kind: "edit", text: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
  }
  if (choice === "selectAll") return { kind: "selectAll" };
  return null;
}
