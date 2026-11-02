import type { MenuItem } from "../../platform/menus";

export type MenuEntry = Extract<MenuItem, { id: string }>;
export type MenuModifier = NonNullable<MenuEntry["modifiers"]>[number];
export type MenuKey = { key?: string; modifiers?: MenuModifier[] };

type Slot<I> = I | false | null | undefined;

export function menuSections(...sections: Slot<MenuItem>[][]): MenuItem[];
export function menuSections<I extends object>(...sections: Slot<I>[][]): (I | { separator: true })[];
export function menuSections<I extends object>(...sections: Slot<I>[][]): (I | { separator: true })[] {
  return sections
    .map((section) => section.filter((item): item is I => !!item))
    .filter((section) => section.length > 0)
    .flatMap((section, i) => (i ? [{ separator: true as const }, ...section] : section));
}

const sameModifiers = (a: readonly MenuModifier[], b: readonly MenuModifier[]) => a.length === b.length && a.every((m) => b.includes(m));

export function withOptionAlternate(primary: MenuEntry, alternate: MenuEntry, keys: { primary?: MenuKey; alternate?: MenuKey } = {}): MenuEntry[] {
  const p = keys.primary ?? {};
  const a = keys.alternate ?? {};
  const pMods = p.modifiers ?? [];
  if (!p.key && !a.key) return [primary, { ...alternate, modifiers: ["option"], alternate: true }];
  const paired = !!p.key && a.key === p.key && !pMods.includes("option") && sameModifiers(a.modifiers ?? [], [...pMods, "option"]);
  if (paired) return [{ ...primary, ...p }, { ...alternate, ...a, alternate: true }];
  return [{ ...primary, ...p }, { ...alternate, ...a }];
}
