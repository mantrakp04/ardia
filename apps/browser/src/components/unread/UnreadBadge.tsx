import { memo, useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Dot, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { capsule, tabularNums } from "../ui/tokens";
import { isHexColor, isLight } from "../../lib/color";
import { useTabUnread, type Unread } from "../../state/tabs/unread";
import { UNREAD_CORNER, UNREAD_DOT, UNREAD_INLINE_GAP, UNREAD_PILL, unreadColors, unreadMotion } from "./tokens";

type Place = "row" | "corner";

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

export function UnreadPill({ label, place, ink }: { label: string; place: Place; ink?: string }) {
  const colors = useInkColors(ink);
  const pill = UNREAD_PILL[place];
  const corner = place === "corner";
  const ring = corner ? UNREAD_CORNER.ring : 0;
  const height = pill.height + ring * 2;
  return (
    <View
      pointerEvents="none"
      style={{
        height,
        minWidth: height,
        borderRadius: capsule(height),
        paddingHorizontal: pill.padX,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: corner ? colors.cornerFill : colors.rowFill,
        borderWidth: ring || undefined,
        borderColor: corner ? colors.cornerRing : undefined,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ ...pill.type, lineHeight: pill.line, fontWeight: pill.weight, color: corner ? colors.cornerInk : colors.rowInk, ...tabularNums, transform: [{ translateY: pill.nudge }] }}
      >
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
      {drawn.kind === "dot" ? <Dot size={UNREAD_DOT.row} color={colors.rowDot} /> : <UnreadPill label={drawn.label} place="row" ink={ink} />}
    </Animated.View>
  );
});

export const UnreadBadge = memo(function UnreadBadge({ tabId, iconSize }: { tabId: string; iconSize: number }) {
  const colors = unreadColors(useTheme().dark);
  const { drawn, motion } = useShownUnread(useTabUnread(tabId));
  if (!drawn) return null;
  if (drawn.kind === "dot")
    return (
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: UNREAD_DOT.cornerTop, right: UNREAD_DOT.cornerRight }, motion]}>
        <Dot size={UNREAD_DOT.corner} color={colors.cornerFill} ring={colors.cornerRing} ringWidth={UNREAD_CORNER.ring} />
      </Animated.View>
    );
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: UNREAD_CORNER.top, left: iconSize - UNREAD_CORNER.centerFromIconRight - UNREAD_CORNER.span / 2, width: UNREAD_CORNER.span, alignItems: "center" }}>
      <Animated.View style={motion}>
        <UnreadPill label={drawn.label} place="corner" />
      </Animated.View>
    </View>
  );
});
