import { memo, useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Dot, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { capsule, tabularNums } from "../ui/tokens";
import { isHexColor, isLight } from "../../lib/color";
import type { Unread } from "../../state/tabs/unread";
import { UNREAD_DOT, UNREAD_INLINE_GAP, UNREAD_PILL, unreadColors, unreadMotion } from "./tokens";

function useShownUnread(unread: Unread | null) {
  const label = unread ? (unread.kind === "dot" ? "" : unread.label) : null;
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
  const motion = { opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [unreadMotion.hiddenScale, 1] }) }] };
  return { drawn, motion };
}

const useInkColors = (ink?: string) => {
  const dark = useTheme().dark;
  return unreadColors(ink && isHexColor(ink) ? isLight(ink) : dark);
};

function UnreadPill({ label, ink }: { label: string; ink?: string }) {
  const colors = useInkColors(ink);
  return (
    <View
      pointerEvents="none"
      style={{
        height: UNREAD_PILL.height,
        minWidth: UNREAD_PILL.height,
        borderRadius: capsule(UNREAD_PILL.height),
        paddingHorizontal: UNREAD_PILL.padX,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.rowFill,
      }}
    >
      <Text numberOfLines={1} style={{ ...UNREAD_PILL.type, lineHeight: UNREAD_PILL.line, fontWeight: UNREAD_PILL.weight, color: colors.rowInk, ...tabularNums }}>
        {label}
      </Text>
    </View>
  );
}

export const UnreadCount = memo(function UnreadCount({ unread, ink }: { unread: Unread | null; ink?: string }) {
  const colors = useInkColors(ink);
  const { drawn, motion } = useShownUnread(unread);
  if (!drawn) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ marginLeft: UNREAD_INLINE_GAP }, motion]}>
      {drawn.kind === "dot" ? <Dot size={UNREAD_DOT} color={colors.rowDot} /> : <UnreadPill label={drawn.label} ink={ink} />}
    </Animated.View>
  );
});
