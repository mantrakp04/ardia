import type { GestureResponderEvent } from "react-native";
import type { ClickModifiers } from "../../browser/src/lib/keys";

export type PointerModifiers = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; middle?: boolean };
export type { ClickModifiers } from "../../browser/src/lib/keys";

export function primaryModifiers(event: PointerModifiers = {}): ClickModifiers {
  return { metaKey: !!event.ctrlKey, shiftKey: !!event.shiftKey, altKey: !!event.altKey };
}

export function modifiersOf(event: GestureResponderEvent | undefined): ClickModifiers {
  return primaryModifiers((event?.nativeEvent ?? {}) as PointerModifiers);
}
