import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

const read = () => (Platform.OS === "ios" ? AccessibilityInfo.isDarkerSystemColorsEnabled() : AccessibilityInfo.isHighTextContrastEnabled());

export function useIncreasedContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void read()
      .then((value) => live && setOn(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(Platform.OS === "ios" ? "darkerSystemColorsChanged" : "highTextContrastChanged", (value: boolean) => setOn(value));
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return on;
}
