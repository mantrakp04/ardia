import { AccessibilityInfo } from "react-native";

let reduce: boolean | null = null;

export const reduceMotionKnown: Promise<boolean> = AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduce = on),
  () => (reduce = false),
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduce = on));

export const reduceMotion = () => reduce;
