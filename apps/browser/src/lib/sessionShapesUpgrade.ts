import type { SavedObject } from "./savedDocument";

const object = (v: unknown): SavedObject => v && typeof v === "object" && !Array.isArray(v) ? v as SavedObject : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const restored = (v: unknown) => typeof v === "string" && v.startsWith("restore:") ? v : undefined;

export function sessionWithLegacyShapes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sessionWithLegacyShapes);
  if (!value || typeof value !== "object") return value;
  const row = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sessionWithLegacyShapes(v)]));
  if (typeof row.url !== "string") return row;
  if ("pin" in row) {
    const pin = object(row.pin);
    row.pinned = pin.as === "tile" || pin.as === "row";
    if (pin.as === "row") row.pinnedAsRow = true;
    const folder = object(pin.folder);
    if (typeof folder.id === "string" && typeof folder.name === "string") row.tileFolder = folder;
    delete row.pin;
  }
  if (row.page) {
    const page = object(row.page);
    row.unloaded = page.kind === "asleep";
    if (restored(page.wake)) row.wakeAdoptId = page.wake;
    delete row.page;
  }
  return row;
}

function withSlots(row: SavedObject): SavedObject {
  const ids = list(row.tabIds ?? row.ids).filter((id): id is string => typeof id === "string");
  if (row.slots || !ids.length || !row.orientation) return row;
  const stack = object(row.stack);
  const at = typeof stack.index === "number" ? stack.index : -1;
  const panes: (string | string[])[] = [];
  for (let i = 0; i < ids.length; i++) panes.push(i === at && i + 1 < ids.length ? [ids[i]!, ids[++i]!] : ids[i]!);
  const sizes = list(row.sizes);
  const validSizes = sizes.length === panes.length && sizes.every((size) => typeof size === "number" && Number.isFinite(size) && size > 0);
  const { tabIds: _t, ids: _i, sizes: _s, stack: _st, ...kept } = row;
  return { ...kept, slots: panes.map((pane, i) => ({ size: validSizes ? sizes[i] : 1 / panes.length, ...(typeof pane === "string" ? { tabId: pane } : { stack: pane, stackSizes: list(stack.sizes).length === 2 ? stack.sizes : [0.5, 0.5] }) })) };
}

export function sessionWithCurrentShapes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sessionWithCurrentShapes);
  if (!value || typeof value !== "object") return value;
  let row = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sessionWithCurrentShapes(v)]));
  row = withSlots(row);
  if (typeof row.url !== "string" || typeof row.spaceId !== "string") return row;
  const { pinned, pinnedAsRow, tileFolder, navigation: _n, adoptId: _a, pageIn: _p, unloaded, wakeAdoptId, ...kept } = row;
  const pin = "pin" in row ? row.pin : pinned === true ? { as: pinnedAsRow ? "row" : "tile", ...(!pinnedAsRow && tileFolder ? { folder: tileFolder } : {}) } : null;
  const wake = restored(wakeAdoptId);
  const page = row.page ?? { kind: unloaded ? "asleep" : "idle", ...(wake ? { wake } : {}) };
  return { ...kept, pin, ...(typeof row.id === "string" && typeof row.windowId === "string" ? { page } : {}) };
}
