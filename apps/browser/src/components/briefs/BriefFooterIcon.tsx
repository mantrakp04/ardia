import { briefColors, briefMotion } from "./tokens";
import { registerBriefHover } from "./devDriver";
import { useWindowId } from "../../state/browser/hooks";
import { useEffect, useId, useRef, useState } from "react";
import { Animated, Image, View } from "react-native";

type Service = "github" | "gmail" | "calendar";
export function BriefFooterIcon({ service }: { service: Service }) {
  const view = useRef<View>(null);
  const windowId = useWindowId();
  const instanceId = useId();
  const [hovered, setHovered] = useState(false);
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!__DEV__) return;
    const key = `${windowId}:${instanceId}:footer:${service}`;
    return registerBriefHover(key, { hovered, measure: () => new Promise((resolve) => { if (view.current) view.current.measureInWindow((x, y, width, height) => resolve([x, y, width, height])); else resolve([]); }) });
  }, [hovered, service, windowId, instanceId]);
  useEffect(() => {
    motion.stopAnimation();
    if (service === "calendar") {
      if (hovered) Animated.sequence([
        Animated.timing(motion, { toValue: -5, duration: briefMotion.bounceUp, easing: briefMotion.out, useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration: briefMotion.bounceDown, easing: briefMotion.into, useNativeDriver: true }),
      ]).start();
      else motion.setValue(0);
    } else Animated.timing(motion, { toValue: hovered ? service === "github" ? -13 : 13 : 0, duration: briefMotion.tilt, useNativeDriver: true }).start();
    return () => motion.stopAnimation();
  }, [hovered, motion, service]);
  const source = service === "github" ? require("../../../assets/site-icons/github.png") : service === "gmail" ? require("../../../assets/site-icons/gmail.png") : require("../../../assets/site-icons/calendar.png");
  return <View ref={view} accessibilityLabel={service === "github" ? "GitHub" : service === "gmail" ? "Gmail" : "Google Calendar"} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}><Animated.View pointerEvents="none" style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center", transform: service === "calendar" ? [{ translateY: motion }] : [{ rotate: motion.interpolate({ inputRange: [-13, 13], outputRange: ["-13deg", "13deg"] }) }] }}><Image source={source} resizeMode="contain" style={{ width: service === "gmail" ? 22 : 20, height: service === "gmail" ? 16 : 20, ...(service === "github" ? { tintColor: briefColors.foreground } : {}) }} /></Animated.View></View>;
}
