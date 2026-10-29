export const BUNDLE_ID = "com.ardia.browser";

export const APP_TARGET = `application id "${BUNDLE_ID}"`;

export type Tab = {
  windowId: string;
  windowIndex: number;
  tabId: string;
  title: string;
  url: string;
  isPinned: boolean;
  isFocused: boolean;
};

export type Space = {
  id: string;
  name: string;
  tabCount: number;
  isCurrent: boolean;
};

export type NewWindowOptions = { spaceId?: string; incognito?: boolean };

const FIELD = "\u001f";
const RECORD = "\u001e";

export const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const records = (output: string) =>
  output
    .split(RECORD)
    .filter((record) => record.trim() !== "")
    .map((record) => record.split(FIELD));

export function listTabsScript(target = APP_TARGET) {
  return `set fs to character id 31
set rs to character id 30
set out to ""
tell ${target}
  set windowIndex to 0
  repeat with w in windows
    set windowIndex to windowIndex + 1
    set wId to id of w
    set tIds to id of every tab of w
    set tTitles to title of every tab of w
    set tURLs to URL of every tab of w
    set tPinned to isPinned of every tab of w
    set tFocused to isFocused of every tab of w
    repeat with i from 1 to count of tIds
      set out to out & wId & fs & windowIndex & fs & (item i of tIds) & fs & (item i of tTitles) & fs & (item i of tURLs) & fs & (item i of tPinned) & fs & (item i of tFocused) & rs
    end repeat
  end repeat
end tell
return out`;
}

export function parseTabs(output: string): Tab[] {
  return records(output).map(
    ([windowId = "", windowIndex = "0", tabId = "", title = "", url = "", pinned = "", focused = ""]) => ({
      windowId: windowId.trim(),
      windowIndex: Number(windowIndex) || 0,
      tabId,
      title,
      url: url === "missing value" ? "" : url,
      isPinned: pinned === "true",
      isFocused: focused === "true",
    }),
  );
}

export function focusTabScript(tab: Pick<Tab, "windowId" | "tabId">, target = APP_TARGET) {
  return `tell ${target} to focus (tab id ${quote(tab.tabId)} of window id ${quote(tab.windowId)})`;
}

export function closeTabScript(tab: Pick<Tab, "windowId" | "tabId">, target = APP_TARGET) {
  return `tell ${target} to close (tab id ${quote(tab.tabId)} of window id ${quote(tab.windowId)})`;
}

export function activateScript(target = APP_TARGET) {
  return `tell ${target} to activate`;
}

export function listSpacesScript(target = APP_TARGET) {
  return `set fs to character id 31
set rs to character id 30
set out to ""
tell ${target}
  set currentId to ""
  try
    set currentId to id of active space of window 1
  end try
  set pIds to id of every space
  set pNames to name of every space
  repeat with i from 1 to count of pIds
    set pId to item i of pIds
    set out to out & pId & fs & (item i of pNames) & fs & (count of tabs of space id pId) & fs & (pId is currentId) & rs
  end repeat
end tell
return out`;
}

export function parseSpaces(output: string): Space[] {
  return records(output).map(([id = "", name = "", tabCount = "0", current = ""]) => ({
    id: id.trim(),
    name,
    tabCount: Number(tabCount) || 0,
    isCurrent: current === "true",
  }));
}

export function spaceNamed(spaces: Space[], name: string): Space {
  const wanted = name.trim();
  const lower = wanted.toLowerCase();
  const exact = spaces.filter((space) => space.name.toLowerCase() === lower);
  const matches = exact.length ? exact : spaces.filter((space) => space.name.toLowerCase().startsWith(lower));
  if (matches.length === 1) return matches[0];
  const names = (matches.length ? matches : spaces).map((space) => space.name).join(", ");
  throw new Error(
    matches.length ? `“${wanted}” matches ${names}.` : `No space is named “${wanted}”. Ardia has ${names}.`,
  );
}

export function showSpaceScript(space: Pick<Space, "id">, target = APP_TARGET) {
  const specifier = `(space id ${quote(space.id)})`;
  return `tell ${target}
  try
    focus ${specifier}
  on error
    make new window with properties {active space:${specifier}}
  end try
end tell`;
}

export function newWindowScript({ spaceId, incognito }: NewWindowOptions = {}, target = APP_TARGET) {
  const properties = incognito
    ? "{incognito:true}"
    : spaceId
      ? `{active space:(space id ${quote(spaceId)})}`
      : "";
  return `tell ${target} to make new window${properties ? ` with properties ${properties}` : ""}`;
}

export function newTabScript(input: string, target = APP_TARGET) {
  const text = input.trim();
  return `tell ${target} to make new tab${text ? ` with properties {URL:${quote(text)}}` : ""}`;
}

export function hostOf(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    return hostname.replace(/^www\./, "") || protocol.replace(/:$/, "");
  } catch {
    return url;
  }
}
