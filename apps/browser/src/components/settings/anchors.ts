import type { View } from "react-native";

const anchors = new Map<string, View>();

export const anchorView = (id: string) => anchors.get(id);

export function registerAnchor(id: string, view: View) {
  anchors.set(id, view);
  return () => {
    if (anchors.get(id) === view) anchors.delete(id);
  };
}
