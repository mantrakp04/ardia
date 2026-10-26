import { Symbol, Button, Text, useTheme } from "../ui";
import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { currentTab } from "../../state/browser/current";
import { ink, space } from "../ui/tokens";
import { pageOf } from "../../state/tabs/pageState";
import { dismissShareBar, shareInstead, stopSharing, useShareFor } from "../../state/media/screenShare";
import { mediaMotion, useMediaTokens } from "./tokens";
import { hostOrOrigin } from "../../lib/url";
import { curve } from "../ui/motion";

const SHARE_BAR_HEIGHT = 38;
const FLEX = { flex: 1 } as const;

export function ShareBar({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const tokens = useMediaTokens();
  const found = useShareFor(tabId);
  const height = useRef(new Animated.Value(0)).current;
  const visible = !!found;
  useEffect(() => {
    Animated.timing(height, { toValue: visible ? SHARE_BAR_HEIGHT : 0, duration: mediaMotion.shareBarSlide, easing: curve.outCubic, useNativeDriver: false }).start();
  }, [visible]);
  const last = useRef(found);
  if (found) last.current = found;
  const shown = found ?? last.current;
  if (!shown) return null;
  const [capturer, share] = shown;
  const isShared = share.capturedTabId === tabId;
  const host = hostOrOrigin(share.origin || pageOf(capturer).security?.origin || currentTab(capturer)?.url || "");
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <View
        style={{
          height: SHARE_BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.ml,
          paddingLeft: space.l,
          paddingRight: space.m,
          borderBottomWidth: 0.5,
          borderBottomColor: tokens.shareBarBorder,
        }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.destructive, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="rectangle.inset.filled" size={9} weight="bold" color={ink.white} style={{ width: 14, height: 14 }} />
        </View>
        <Text lines={1} tone="textSecondary" style={FLEX}>
          {"Sharing "}
          <Text weight="semibold">{isShared ? "this tab" : "another tab"}</Text>
          {` with ${host}`}
        </Text>
        {isShared ? (
          <Button variant="pill" title="Stop Sharing" onPress={() => stopSharing(capturer)} />
        ) : (
          <Button variant="pill" title="Share This Tab Instead" primary onPress={() => void shareInstead(capturer, tabId)} />
        )}
        <Button variant="pill" title="Dismiss" onPress={() => dismissShareBar(capturer, tabId)} />
      </View>
    </Animated.View>
  );
}
