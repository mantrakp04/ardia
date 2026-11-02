import type { GestureResponderEvent } from "react-native";

export type ClickModifiers = { metaKey: boolean; altKey: boolean; shiftKey: boolean };
export function modifiersOf(e: GestureResponderEvent | undefined): ClickModifiers {
  const n = (e?.nativeEvent ?? {}) as Partial<ClickModifiers>;
  return { metaKey: !!n.metaKey, altKey: !!n.altKey, shiftKey: !!n.shiftKey };
}
