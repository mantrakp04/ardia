import { DEFAULT_LOOK, type ThemeLook } from "./themeLook";

let active: ThemeLook = DEFAULT_LOOK;

export const activeLook = (): ThemeLook => active;

export function setActiveLook(look: ThemeLook) {
  active = look;
}

export const iconName = (name: string): string => active.icons.get(name) ?? name;

type SymbolItem = { symbol?: string; children?: SymbolItem[] } | { separator: true };

export function withIconNames<T extends SymbolItem>(items: T[]): T[] {
  if (!active.icons.size) return items;
  return items.map((item) => {
    if ("separator" in item) return item;
    const symbol = item.symbol === undefined ? undefined : iconName(item.symbol);
    return { ...item, ...(symbol === undefined ? {} : { symbol }), ...(item.children ? { children: withIconNames(item.children) } : {}) } as T;
  });
}
