import { useEffect, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, type View } from "react-native";

export function useCoverFocus(target: RefObject<View | null>) {
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (!on || !live) return;
      requestAnimationFrame(() => {
        const handle = target.current ? findNodeHandle(target.current) : null;
        if (live && handle) AccessibilityInfo.setAccessibilityFocus(handle);
      });
    });
    return () => {
      live = false;
    };
  }, [target]);
}
