import { memo, useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Dot, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { capsule, tabularNums } from "../ui/tokens";
import { isHexColor, isLight } from "../../lib/color";
import { useTabUnread, type Unread } from "../../state/tabs/unread";
import { UNREAD_DOT, UNREAD_INLINE_GAP, UNREAD_PILL, UNREAD_TILE, unreadColors, unreadMotion } from "./tokens";

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

function UnreadPill({ label, place, ink }: { label: string; place: keyof typeof UNREAD_PILL; ink?: string }) {
  const colors = useInkColors(ink);
  const pill = UNREAD_PILL[place];
  return (
    <View
      pointerEvents="none"
      style={{
        height: pill.height,
        minWidth: pill.height,
        borderRadius: capsule(pill.height),
        paddingHorizontal: pill.padX,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: place === "tile" ? colors.tileFill : colors.rowFill,
      }}
    >
      <Text numberOfLines={1} style={{ ...pill.type, lineHeight: pill.line, fontWeight: pill.weight, color: colors.rowInk, ...tabularNums }}>
        {label}
      </Text>
    </View>
  );
}

export const UnreadCount = memo(function UnreadCount({ unread, ink, onDrawn }: { unread: Unread | null; ink?: string; onDrawn?: (drawn: boolean) => void }) {
  const colors = useInkColors(ink);
  const { drawn, motion } = useShownUnread(unread);
  const isDrawn = !!drawn;
  useEffect(() => onDrawn?.(isDrawn), [isDrawn, onDrawn]);
  if (!drawn) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ marginLeft: UNREAD_INLINE_GAP }, motion]}>
      {drawn.kind === "dot" ? <Dot size={UNREAD_DOT} color={colors.rowDot} /> : <UnreadPill label={drawn.label} place="row" ink={ink} />}
    </Animated.View>
  );
});

export const TileUnread = memo(function TileUnread({ tabId }: { tabId: string }) {
  const colors = useInkColors();
  const { drawn, motion } = useShownUnread(useTabUnread(tabId));
  if (!drawn) return null;
  const inset = drawn.kind === "dot" ? UNREAD_TILE.dotInset : UNREAD_TILE.inset;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", top: inset, right: inset }, motion]}>
      {drawn.kind === "dot" ? <Dot size={UNREAD_DOT} color={colors.rowDot} /> : <UnreadPill label={drawn.label} place="tile" />}
    </Animated.View>
  );
});
