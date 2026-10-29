import { isFields, isString, isStringList } from "../../lib/decode";
import type { SavedObject } from "../../lib/savedDocument";
import { isAdoptKind } from "../tabs/adoptIds";
import { wakeOf } from "../tabs/pageSession";
import { isIncognitoProfile } from "../browser/model";
import type { AdoptId, ParkedPins, SplitSlot, SplitView, Tab, TabPage, TabPin, TileFolder } from "../browser/types";

type SavedPage = Extract<TabPage, { kind: "idle" | "asleep" }>;
const isRestoreId = (v: unknown): v is AdoptId => isString(v) && isAdoptKind(v, "restore");
const LEGACY_PAGE_FIELDS = ["navigation", "adoptId", "pageIn", "unloaded", "wakeAdoptId"];
export const sessionWithTabPages = (doc: SavedObject): SavedObject => ({
  ...doc,
  tabs: Array.isArray(doc.tabs)
    ? doc.tabs.map((t: unknown) => {
        if (!isFields(t) || (isFields(t.page) && !LEGACY_PAGE_FIELDS.some((k) => k in t))) return t;
        const { navigation: _n, adoptId: _a, pageIn: _p, unloaded, wakeAdoptId, ...tab } = t;
        return { ...tab, page: { kind: unloaded === true ? "asleep" : "idle", ...(isRestoreId(wakeAdoptId) ? { wake: wakeAdoptId } : {}) } };
      })
    : doc.tabs,
});
const folderOf = (v: unknown): TileFolder | undefined =>
  isFields(v) && isString(v.id) && isString(v.name) ? { id: v.id, name: v.name, ...(typeof v.renamedAt === "number" ? { renamedAt: v.renamedAt } : {}) } : undefined;
const withPin = (t: unknown): unknown => {
  if (!isFields(t) || ("pin" in t && !("pinned" in t) && !("pinnedAsRow" in t) && !("tileFolder" in t))) return t;
  const { pinned, pinnedAsRow, tileFolder, ...tab } = t;
  const folder = folderOf(tileFolder);
  return { ...tab, pin: pinned !== true ? null : pinnedAsRow === true ? { as: "row" } : folder ? { as: "tile", folder } : { as: "tile" } };
};
export const pinFromDisk = (v: unknown): TabPin | null => {
  if (!isFields(v)) return null;
  if (v.as === "row") return { as: "row" };
  if (v.as !== "tile") return null;
  const folder = folderOf(v.folder);
  return folder ? { as: "tile", folder } : { as: "tile" };
};
const withPins = (list: unknown) => (Array.isArray(list) ? list.map(withPin) : list);
const entriesWith = (list: unknown, key: "tab" | "tabs") =>
  Array.isArray(list) ? list.map((e: unknown) => (isFields(e) && key in e ? { ...e, [key]: key === "tab" ? withPin(e.tab) : withPins(e.tabs) } : e)) : list;
export const sessionWithTabPins = (doc: SavedObject): SavedObject => ({
  ...doc,
  tabs: withPins(doc.tabs),
  closedTabs: entriesWith(doc.closedTabs, "tab"),
  cleanedTabs: entriesWith(doc.cleanedTabs, "tab"),
  closedWindows: entriesWith(doc.closedWindows, "tabs"),
  closedGroups: entriesWith(doc.closedGroups, "tabs"),
  deletedGroups: entriesWith(doc.deletedGroups, "tabs"),
  parkedPins: isFields(doc.parkedPins) ? Object.fromEntries(Object.entries(doc.parkedPins).map(([p, park]) => [p, isFields(park) ? { ...park, tabs: withPins(park.tabs) } : park])) : doc.parkedPins,
});
const isSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const sizesOr = (v: unknown, n: number): number[] => (Array.isArray(v) && v.length === n && v.every(isSize) ? v : Array.from({ length: n }, () => 1 / n));
const slotsFromPanes = (ids: string[], sizes: unknown, stack: unknown): SplitSlot[] => {
  const at = isFields(stack) && Number.isInteger(stack.index) && (stack.index as number) >= 0 && (stack.index as number) < ids.length - 1 ? (stack.index as number) : -1;
  const stackSizes = sizesOr(isFields(stack) ? stack.sizes : undefined, 2) as [number, number];
  const panes: (string | [string, string])[] = [];
  for (let i = 0; i < ids.length; i++) panes.push(i === at ? [ids[i]!, ids[++i]!] : ids[i]!);
  const outer = sizesOr(sizes, panes.length);
  return panes.map((pane, i) => (typeof pane === "string" ? { size: outer[i]!, tabId: pane } : { size: outer[i]!, stack: pane, stackSizes }));
};
const withSlots = (v: unknown, idsKey: "tabIds" | "ids"): unknown => {
  if (!isFields(v)) return v;
  const { [idsKey]: ids, sizes, stack, ...split } = v;
  return isStringList(ids) ? { ...split, slots: slotsFromPanes(ids, sizes, stack) } : v;
};
export const sessionWithSplitSlots = (doc: SavedObject): SavedObject => ({
  ...doc,
  splits: Array.isArray(doc.splits) ? doc.splits.map((v: unknown) => withSlots(v, "tabIds")) : doc.splits,
  parkedPins: isFields(doc.parkedPins)
    ? Object.fromEntries(Object.entries(doc.parkedPins).map(([p, park]) => [p, isFields(park) && Array.isArray(park.splits) ? { ...park, splits: park.splits.map((v: unknown) => withSlots(v, "ids")) } : park]))
    : doc.parkedPins,
});
const slotFromDisk = (v: unknown): SplitSlot | null => {
  if (!isFields(v) || !isSize(v.size)) return null;
  if (isString(v.tabId)) return { size: v.size, tabId: v.tabId };
  if (isStringList(v.stack) && v.stack.length === 2) return { size: v.size, stack: [v.stack[0]!, v.stack[1]!], stackSizes: sizesOr(v.stackSizes, 2) as [number, number] };
  return null;
};
export const slotsFromDisk = (v: unknown): SplitSlot[] | null => {
  const slots = Array.isArray(v) ? v.map(slotFromDisk) : [];
  return slots.length && slots.every((x) => x) ? (slots as SplitSlot[]) : null;
};
export const savedPage = (t: Tab): SavedPage => {
  const wake = wakeOf(t);
  const kind = t.page.kind === "asleep" || t.page.kind === "frozen" ? "asleep" : "idle";
  return isRestoreId(wake) && !isIncognitoProfile(t.profileId) ? { kind, wake } : { kind };
};
export const pageFromDisk = (v: unknown): SavedPage => {
  const page = isFields(v) ? v : {};
  const kind = page.kind === "asleep" ? "asleep" : "idle";
  return isRestoreId(page.wake) ? { kind, wake: page.wake } : { kind };
};

export const parkedSplitsChecked = (park: ParkedPins): ParkedPins => {
  if (!Array.isArray(park.splits)) {
    const { splits: _, ...rest } = park;
    return rest;
  }
  const splits = (park.splits as unknown[]).flatMap((v): ParkedPins["splits"] & object => {
    const slots = isFields(v) && (v.orientation === "horizontal" || v.orientation === "vertical") ? slotsFromDisk(v.slots) : null;
    return slots && isFields(v) ? [{ orientation: v.orientation as SplitView["orientation"], slots }] : [];
  });
  return { ...park, splits };
};
