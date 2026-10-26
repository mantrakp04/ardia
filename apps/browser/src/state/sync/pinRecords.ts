import type { TabGroup } from "../browser/types";

export type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
export type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };
export type NestGroupValue = { n: string; i: string | null; c: TabGroup["color"]; p: string };
export type NestTabValue = { g: string };
export const PIN_NEST = "pinn:";
export const GROUP_LOOK = "pgc:";
export const NO_BOX = "none";

export const legacyColor = (color: TabGroup["color"]): TabGroup["color"] => (color === "none" ? null : color);
export const lookedColor = (color: TabGroup["color"] | undefined, look: unknown): TabGroup["color"] => ((color ?? null) === null && look === NO_BOX ? "none" : (color ?? null));

export const PIN_ORDER = "pord:g:";
export type PinOrderValue = { a: string | null };
export const anchorIn = (value: unknown) => (value as PinOrderValue | undefined)?.a;

export const PIN_ROW = "pinrow:";
export const ROW = 1;
export const TILE = 0;

export const PIN_HOME = "pgh:";

export const syncedHome = (value: unknown) => (typeof value === "string" && value ? value : undefined);
export const syncedHomeIn = (base: (key: string) => unknown, key: string) => syncedHome(base(`${PIN_HOME}${key}`));

export const TILE_FOLDER = "tilefold:";
export const FOLDER_NAME = `${TILE_FOLDER}n:`;
export type TileFolderValue = { f: string };
export type FolderNameValue = { n: string };

export const syncedFolderId = (value: unknown) => {
  const v = value as TileFolderValue | undefined;
  return v && typeof v.f === "string" ? v.f : undefined;
};
export const syncedName = (value: unknown) => {
  const v = value as FolderNameValue | undefined;
  return v && typeof v.n === "string" ? v.n : undefined;
};
export const folderMark = (base: (key: string) => unknown, key: string) => {
  const id = syncedFolderId(base(`${TILE_FOLDER}${key}`));
  return id ? { tileFolder: { id, name: syncedName(base(`${FOLDER_NAME}${id}`)) ?? "" } } : {};
};
