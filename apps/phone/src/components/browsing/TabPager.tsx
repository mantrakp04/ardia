import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { incomingPose, outgoingPose, PAGER, resolvedOffset, snapTarget } from "../../lib/pagerPhysics";
import { usePageTone } from "../../state/browse/hooks";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { TabFace, tabsInk, tabsLayout, tabsMotion, useTheme } from "../ui";

export type TabPager = {
  offset: SharedValue<number>;
  active: SharedValue<number>;
  gesture: ReturnType<typeof Gesture.Pan>;
  outgoing: ReturnType<typeof useAnimatedStyle>;
  dim: ReturnType<typeof useAnimatedStyle>;
};

type Options = { width: number; selectedId: string | null; left: string | null; right: string | null; onCommit: (id: string) => void; onGrab: () => void };

export function useTabPager({ width, selectedId, left, right, onCommit, onGrab }: Options): TabPager {
  const offset = useSharedValue(0);
  const active = useSharedValue(0);
  const base = useSharedValue(0);
  const hasLeft = useSharedValue(left !== null);
  const hasRight = useSharedValue(right !== null);
  const span = useSharedValue(width);

  useEffect(() => {
    hasLeft.value = left !== null;
    hasRight.value = right !== null;
    span.value = width;
  }, [hasLeft, hasRight, left, right, span, width]);

  useEffect(() => {
    offset.value = 0;
    active.value = 0;
  }, [active, offset, selectedId]);

  const commit = (target: number) => {
    const id = target > 0 ? left : right;
    if (id) onCommit(id);
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-PAGER.minimumDistance, PAGER.minimumDistance])
    .failOffsetY([-PAGER.minimumDistance, PAGER.minimumDistance])
    .onStart(() => {
      if (!active.value) runOnJS(onGrab)();
      active.value = 1;
      base.value = offset.value;
    })
    .onUpdate((event) => {
      offset.value = resolvedOffset(base.value + event.translationX, hasLeft.value, hasRight.value, span.value);
    })
    .onEnd((event) => {
      const velocity = Math.min(Math.max(event.velocityX, -PAGER.maxVelocity), PAGER.maxVelocity);
      const target = snapTarget(offset.value, velocity, span.value, hasLeft.value, hasRight.value);
      offset.value = withSpring(target * span.value, { ...tabsMotion.pagerSettle, velocity }, (finished) => {
        if (!finished) return;
        if (target === 0) active.value = 0;
        else runOnJS(commit)(target);
      });
    });

  const outgoing = useAnimatedStyle(() => {
    const pose = outgoingPose(offset.value, span.value, hasLeft.value, hasRight.value);
    return { transform: [{ translateX: pose.x }, { scale: pose.scale }], borderRadius: active.value ? tabsLayout.displayCornerRadius : 0 };
  });
  const dim = useAnimatedStyle(() => ({ opacity: outgoingPose(offset.value, span.value, hasLeft.value, hasRight.value).dim }));

  return { offset, active, gesture, outgoing, dim };
}

type NeighbourProps = { pager: TabPager; tab: BrowserTab; side: -1 | 1; width: number; statusHeight: number; hasLeft: boolean; hasRight: boolean };

export function PagerNeighbour({ pager, tab, side, width, statusHeight, hasLeft, hasRight }: NeighbourProps) {
  const theme = useTheme();
  const tone = usePageTone(tab.id);
  const { offset } = pager;
  const style = useAnimatedStyle(() => {
    const pose = incomingPose(side, offset.value, width, hasLeft, hasRight);
    return { opacity: pose.opacity, transform: [{ translateX: pose.x }] };
  });
  const shown = display(tab.url);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.card, { backgroundColor: theme.surface }, style]} pointerEvents="none">
      <View style={{ height: statusHeight, backgroundColor: tone?.top ?? theme.surface }} />
      <View style={styles.body}>
        <TabFace tab={tab} title={tab.title || shown.host} host={shown.host} tone={tone?.top ?? null} roles={theme} />
      </View>
    </Animated.View>
  );
}

export function PagerBlack() {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: tabsInk.pagerBlack }]} />;
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", borderRadius: tabsLayout.displayCornerRadius },
  body: { flex: 1 },
});
