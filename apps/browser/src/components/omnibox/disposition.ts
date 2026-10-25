export type Disposition = "current" | "background" | "split" | "newWindow";

export function dispositionFor(mods: { metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): Disposition {
  if (mods.metaKey) return "background";
  if (mods.altKey) return "split";
  if (mods.shiftKey) return "newWindow";
  return "current";
}
