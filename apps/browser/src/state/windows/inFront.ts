import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { backgroundInstance } from "../app/appSettings";
import { useBrowser } from "../browser/store";
import { focusedWindowOf } from "./ui";

const subscribe = (changed: () => void) => {
  const sub = AppState.addEventListener("change", changed);
  return () => sub.remove();
};
const appActive = () => backgroundInstance || AppState.currentState === "active";

export function useWindowInFront(windowId: string | undefined) {
  const active = useSyncExternalStore(subscribe, appActive);
  const focused = useBrowser((s) => !!windowId && focusedWindowOf(s) === windowId);
  return active && focused;
}
