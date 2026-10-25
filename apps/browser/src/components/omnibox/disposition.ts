export type Disposition = "current" | "newTab" | "background" | "split" | "newWindow";

export function dispositionFor(mods: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean }): Disposition {
  if (mods.metaKey) return "newTab";
  if (mods.altKey) return "split";
  if (mods.shiftKey) return "newWindow";
  if (mods.ctrlKey) return "background";
  return "current";
}
