import { isFields, isNumber, isString } from "../../lib/decode";
import type { TopApp } from "../browser/types";

const nullableString = (value: unknown) => value === null || isString(value);

export function topAppValue(value: unknown): TopApp | null {
  if (!isFields(value) || !isString(value.key) || !value.key || !isString(value.url) || !isString(value.title)
    || !nullableString(value.favicon) || !nullableString(value.customTitle) || !nullableString(value.customIcon)) return null;
  const folder = value.tileFolder;
  if (folder !== undefined && (!isFields(folder) || !isString(folder.id) || !isString(folder.name)
    || folder.renamedAt !== undefined && !isNumber(folder.renamedAt))) return null;
  return value as TopApp;
}
