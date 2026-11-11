import { memo, useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Badge, Dot } from "../ui";
import { useTabUnread, type Unread } from "../../state/tabs/unread";
import { useLiveColors } from "../live/tokens";
import { UNREAD_COUNT_BOX, UNREAD_DOT, UNREAD_FILL, UNREAD_INK, UNREAD_INLINE_GAP, unreadMotion } from "./tokens";

export const UnreadBadge = memo(function UnreadBadge({ tabId, inline = false }: { tabId: string; inline?: boolean }) {
  const unread = useTabUnread(tabId);
  const label = unread ? (unread.kind === "dot" ? "" : unread.label) : null;
  const ring = useLiveColors().badgeRing;
  const shown = useRef(new Animated.Value(unread ? 1 : 0)).current;
  const [drawn, setDrawn] = useState<Unread | null>(unread);
  useEffect(() => {
    if (!unread && !drawn) return;
    if (unread) setDrawn(unread);
    const spring = Animated.spring(shown, { toValue: unread ? 1 : 0, ...(unread ? unreadMotion.show : unreadMotion.hide), useNativeDriver: true });
    spring.start(({ finished }) => {
      if (finished && !unread) setDrawn(null);
    });
    return () => spring.stop();
  }, [label]);
  if (!drawn) return null;
  const motion = { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [unreadMotion.hiddenScale, 1] }) }] };
  if (inline)
    return (
      <Animated.View pointerEvents="none" style={[{ marginLeft: UNREAD_INLINE_GAP }, motion]}>
        {drawn.kind === "dot" ? <Dot size={UNREAD_DOT.size} color={UNREAD_FILL} /> : <Badge text={drawn.label} size="s" fill={UNREAD_FILL} color={UNREAD_INK} />}
      </Animated.View>
    );
  if (drawn.kind === "dot")
    return (
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: UNREAD_DOT.top, right: UNREAD_DOT.right }, motion]}>
        <Dot size={UNREAD_DOT.size} color={UNREAD_FILL} ring={ring} />
      </Animated.View>
    );
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: UNREAD_COUNT_BOX.top, right: UNREAD_COUNT_BOX.right, width: UNREAD_COUNT_BOX.width, alignItems: "flex-end" }}>
      <Animated.View style={motion}>
        <Badge text={drawn.label} size="s" fill={UNREAD_FILL} color={UNREAD_INK} ring={ring} />
      </Animated.View>
    </View>
  );
});
