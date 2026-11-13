import { useEffect } from "react";
import { Animated, Pressable, View } from "react-native";
import { goToNoticedTab, holdNewTabNotice, usePaneNewTabNotice } from "../../state/tabs/newTabNotice";
import { capsule, space, Symbol, Text, useHover, usePresence } from "../ui";
import { useTheme } from "../ui/theme";
import { Hud } from "./Hud";
import { NEW_TAB_NOTICE, windowColors } from "./tokens";

export function NewTabNotice({ windowId, tabId, right, top }: { windowId: string; tabId: string; right: number; top: number }) {
  const theme = useTheme();
  const live = usePaneNewTabNotice(windowId, tabId);
  const { shown, appear } = usePresence(live, NEW_TAB_NOTICE.motion);
  const { hovered, hoverProps } = useHover();
  const hover = !!live && hovered;
  useEffect(() => {
    if (!live || !hover) return;
    holdNewTabNotice(windowId, live, true);
    return () => holdNewTabNotice(windowId, live, false);
  }, [hover, live, windowId]);
  if (!shown) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right, top }}>
      <Animated.View
        pointerEvents={live ? "auto" : "none"}
        style={{
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-NEW_TAB_NOTICE.rise, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
        }}
      >
        <View {...hoverProps} style={POINTER}>
          <Pressable onPress={() => goToNoticedTab(windowId, shown)} accessibilityRole="button" accessibilityLabel="New tab opened. Go to the new tab." style={POINTER}>
            {({ pressed }) => (
              <View style={{ opacity: pressed ? NEW_TAB_NOTICE.pressedOpacity : 1 }}>
                <Hud shape="capsule" height={NEW_TAB_NOTICE.height}>
                  <View style={[ROW, { backgroundColor: hover ? windowColors(theme.dark).noticeHover : undefined }]}>
                    <Symbol name="plus.square.on.square" size={12} weight="semibold" color={theme.icon} style={ICON} />
                    <Text size="small" weight="semibold" numberOfLines={1}>
                      New tab opened
                    </Text>
                    <Symbol name="arrow.right" size={10} weight="semibold" color={hover ? theme.textPrimary : theme.textSecondary} style={ICON} />
                  </View>
                </Hud>
              </View>
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const ICON = { width: 14, height: 14 } as const;
const ROW = { height: NEW_TAB_NOTICE.height, borderRadius: capsule(NEW_TAB_NOTICE.height), flexDirection: "row", alignItems: "center", gap: space.s, paddingHorizontal: space.l } as const;
const POINTER = { cursor: "pointer" } as const;
