import { AccessibilityInfo } from "react-native";

let reduceMotion = true;
let revision = 0;
let subscription: ReturnType<typeof AccessibilityInfo.addEventListener> | undefined;
const listeners = new Set<() => void>();
const update = (on: boolean) => {
  revision++;
  if (reduceMotion === on) return;
  reduceMotion = on;
  for (const listener of listeners) listener();
};

export const tabPressMotion = {
  getSnapshot: () => reduceMotion,
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
      const initial = ++revision;
      subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
      AccessibilityInfo.isReduceMotionEnabled().then((on) => {
        if (revision === initial) update(on);
      }, () => {});
    }
    return () => {
      if (!listeners.delete(listener) || listeners.size) return;
      revision++;
      subscription?.remove();
      subscription = undefined;
      reduceMotion = true;
    };
  },
};
