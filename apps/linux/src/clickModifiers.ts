import type { GestureResponderEvent } from "react-native";
import type { ClickModifiers } from "../../browser/src/lib/keys";

export type PointerModifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean };
export type { ClickModifiers } from "../../browser/src/lib/keys";

export function primaryModifiers(event: PointerModifiers = {}): ClickModifiers {
  return { metaKey: !!event.ctrlKey, shiftKey: !!event.shiftKey, altKey: !!event.altKey };
}

export type MenuModifier = "command" | "control" | "option" | "shift";

export function heldModifiers(event: PointerModifiers): ReadonlySet<MenuModifier> {
  const held = new Set<MenuModifier>();
  if (event.ctrlKey) held.add("command");
  if (event.metaKey) held.add("control");
  if (event.altKey) held.add("option");
  if (event.shiftKey) held.add("shift");
  return held;
}

export function modifiersOf(event: GestureResponderEvent | undefined): ClickModifiers {
  return primaryModifiers((event?.nativeEvent ?? {}) as PointerModifiers);
}
