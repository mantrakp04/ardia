import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  deckCardAt,
  deckGeometry,
  deckRubberBand,
  deckSettleTarget,
  deckShouldClose,
  focusedIndex,
  initialDeckScroll,
  openingDeckScroll,
  scrollAfterRemoving,
} from "../../lib/deckGeometry";
import {
  closeAllFromDeck,
  closeTabFromDeck,
  consumeDeckEntrance,
  leaveIncognito,
  newIncognitoTab,
  newRegularTab,
  newTab,
  openArchive,
  openTab,
  reopenLastClosed,
} from "../../state/browse/store";
import { useCanReopen, useDeckOrder, useHasArchivedTabs, useIncognito, usePrivateCount } from "../../state/tabs/hooks";
import { Backdrop, Menu, tabsCurve, tabsLayout, tabsMotion, useTheme, type MenuItem } from "../ui";
import { DeckBar } from "./DeckBar";
import { DeckCard, type DeckMotion, type DeckRole } from "./DeckCard";
import { DeckEmpty, IncognitoChip } from "./DeckChrome";

type Phase = { kind: "opening" | "settled" | "closing"; id: string | null };

function roleOf(phase: Phase, id: string, index: number, order: readonly string[]): DeckRole {
  if (phase.kind === "settled" || !phase.id) return "stay";
  const expanded = order.indexOf(phase.id);
  if (expanded < 0) return "stay";
  if (id === phase.id) return "expanded";
  if (phase.kind === "opening") return index < expanded ? "launcher" : "slideRight";
  return index < expanded ? "slideLeft" : "slideRight";
}

export function TabDeck() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const g = useMemo(() => deckGeometry(width, height, insets.top, insets.bottom), [width, height, insets.top, insets.bottom]);
  const live = useDeckOrder();
  const incognito = useIncognito();
  const privateCount = usePrivateCount();
  const canReopen = useCanReopen();
  const hasArchive = useHasArchivedTabs();
  const [order, setOrder] = useState<string[]>(() => live.map((t) => t.id));
  const [shift, setShift] = useState({ by: 0, generation: 0 });
  const [phase, setPhase] = useState<Phase>({ kind: "settled", id: null });
  const [menu, setMenu] = useState<"plus" | "chip" | null>(null);
  const hidden = useRef(new Set<string>());
  const motion: DeckMotion = {
    scroll: useSharedValue(initialDeckScroll(order.length)),
    scaleProgress: useSharedValue(1),
    positionProgress: useSharedValue(1),
    dragIndex: useSharedValue(-1),
    dragLift: useSharedValue(0),
    flyIndex: useSharedValue(-1),
    flyLift: useSharedValue(0),
    flyVanish: useSharedValue(0),
  };
  const { scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish } = motion;
  const tabs = useMemo(() => new Map(live.map((t) => [t.id, t])), [live]);

  useEffect(() => {
    const entrance = consumeDeckEntrance();
    const index = entrance ? order.indexOf(entrance) : -1;
    if (index < 0) return;
    scroll.value = openingDeckScroll(index, order.length);
    setPhase({ kind: "opening", id: entrance });
    scaleProgress.value = 0;
    positionProgress.value = 0;
    scaleProgress.value = withSpring(1, tabsMotion.openScale);
    positionProgress.value = withSpring(1, tabsMotion.openPosition, (finished) => {
      if (finished) runOnJS(setPhase)({ kind: "settled", id: null });
    });
  }, []);

  useEffect(() => {
    const ids = live.map((t) => t.id);
    const alive = new Set(ids);
    const kept = order.filter((id) => alive.has(id));
    const known = new Set(kept);
    const next = [...kept, ...ids.filter((id) => !known.has(id))];
    if (next.length === order.length && next.every((id, i) => id === order[i])) return;
    const before = scroll.value;
    const focused = order[focusedIndex(before, order.length)];
    const stays = focused ? next.indexOf(focused) : -1;
    const removedAt = focused ? order.indexOf(focused) : 0;
    const after = stays >= 0 ? stays : scrollAfterRemoving(removedAt, Math.round(before), next.length);
    for (const id of hidden.current) if (!alive.has(id)) hidden.current.delete(id);
    flyIndex.value = -1;
    flyVanish.value = 0;
    flyLift.value = 0;
    scroll.value = after;
    setShift((s) => ({ by: after - before, generation: s.generation + 1 }));
    setOrder(next);
  }, [live]);

  const settledOpen = (id: string) => openTab(id);

  const open = (index: number) => {
    const id = order[index];
    if (!id || phase.kind !== "settled") return;
    setMenu(null);
    setPhase({ kind: "closing", id });
    scaleProgress.value = withSpring(0, tabsMotion.expand);
    positionProgress.value = withSpring(0, tabsMotion.expand, (finished) => {
      if (finished) runOnJS(settledOpen)(id);
    });
  };

  const remove = (id: string) => {
    hidden.current.add(id);
    closeTabFromDeck(id);
  };

  const close = (index: number, startLift: number) => {
    const id = order[index];
    if (!id) return;
    flyIndex.value = index;
    flyLift.value = startLift;
    flyVanish.value = 0;
    dragIndex.value = -1;
    flyLift.value = withTiming(startLift - g.cardHeight * 0.18, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    flyVanish.value = withTiming(1, { duration: tabsMotion.flyAway, easing: tabsCurve.easeOut });
    setTimeout(() => remove(id), tabsMotion.flyAway * 0.6);
  };

  const count = order.length;
  const startScroll = useSharedValue(0);
  const vertical = useSharedValue(false);
  const pan = Gesture.Pan()
    .minDistance(10)
    .onStart((e) => {
      const card = deckCardAt(g, count, scroll.value, e.x - e.translationX, e.y - e.translationY);
      if (card >= 0 && Math.abs(e.translationY) > Math.abs(e.translationX) && e.translationY < 0) {
        vertical.value = true;
        dragIndex.value = card;
        dragLift.value = 0;
        return;
      }
      vertical.value = false;
      startScroll.value = scroll.value;
    })
    .onUpdate((e) => {
      if (vertical.value) {
        dragLift.value = e.translationY < 0 ? e.translationY : e.translationY * 0.12;
        return;
      }
      scroll.value = deckRubberBand(startScroll.value - e.translationX / g.spacing, count);
    })
    .onEnd((e) => {
      if (vertical.value) {
        const card = dragIndex.value;
        if (deckShouldClose(e.translationY, e.velocityY, g.cardHeight)) {
          runOnJS(close)(card, dragLift.value);
        } else {
          dragLift.value = withSpring(0, tabsMotion.release, (finished) => {
            if (finished) dragIndex.value = -1;
          });
        }
        return;
      }
      const target = deckSettleTarget(g, scroll.value, e.velocityX, count);
      const distance = target - scroll.value;
      const raw = -e.velocityX / g.spacing;
      const velocity = Math.abs(distance) <= 0.001 ? 0 : Math.min(Math.max(raw / distance, -30), 30) * distance;
      scroll.value = withSpring(target, { ...tabsMotion.settle, velocity });
    });
  const tap = Gesture.Tap().onEnd((e, success) => {
    if (!success) return;
    const card = deckCardAt(g, count, scroll.value, e.x, e.y);
    if (card >= 0) runOnJS(open)(card);
  });

  const confirmCloseAll = () =>
    Alert.alert(count === 1 ? "Close 1 Tab?" : `Close ${count} Tabs?`, privateCount ? "Incognito tabs aren’t saved. Other tabs stay in your Archive." : "They’ll stay in your Archive.", [
      { text: "Cancel", style: "cancel" },
      { text: count === 1 ? "Close Tab" : "Close All Tabs", style: "destructive", onPress: closeAllFromDeck },
    ]);
  const confirmLeaveIncognito = () =>
    Alert.alert("Close Incognito Tabs?", "Their pages, cookies and history are cleared.", [
      { text: "Cancel", style: "cancel" },
      { text: "Close Incognito Tabs", style: "destructive", onPress: leaveIncognito },
    ]);

  const plusItems: MenuItem[] = incognito
    ? [
        { label: "New Tab", icon: "plus", onPress: newRegularTab },
        { label: "New Incognito Tab", icon: "eyes", onPress: newTab },
      ]
    : [
        { label: "New Incognito Tab", icon: "eyes", onPress: newIncognitoTab },
        ...(canReopen ? [{ label: "Reopen Closed Tab", icon: "arrowUturnBackward" as const, onPress: reopenLastClosed }] : []),
      ];
  if (count) plusItems.push("divider", { label: incognito ? "Close Incognito Tabs" : "Close All Tabs", icon: "xmark", destructive: true, onPress: incognito ? confirmLeaveIncognito : confirmCloseAll });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Backdrop colors={theme.backdrop} />
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View style={[styles.touch, { height: g.barCenterY - tabsLayout.barTouchClearance }]} collapsable={false}>
          {order.map((id, index) => {
            const tab = tabs.get(id);
            if (!tab || hidden.current.has(id)) return null;
            return <DeckCard key={id} tab={tab} index={index} isLast={index === count - 1} role={roleOf(phase, id, index, order)} geometry={g} motion={motion} shift={shift} />;
          })}
        </View>
      </GestureDetector>
      {!count && phase.kind === "settled" ? <DeckEmpty centerY={g.cardCenterY} showsArchive={hasArchive} onArchive={openArchive} /> : null}
      {privateCount > 0 && phase.kind === "settled" ? <IncognitoChip count={privateCount} top={g.safeTop} onPress={() => setMenu("chip")} /> : null}
      {phase.kind === "settled" ? (
        <View style={[styles.bar, { top: g.barCenterY - tabsLayout.barPlus.height / 2 - 2, paddingHorizontal: tabsLayout.barSideInset - 4 }]}>
          <DeckBar
            leading={{ icon: "archivebox", label: "Archive", onPress: openArchive }}
            plusLabel={incognito ? "New Incognito Tab" : "New Tab"}
            onPlus={newTab}
            onPlusMenu={() => setMenu("plus")}
          />
        </View>
      ) : null}
      {menu === "plus" ? <Menu items={plusItems} place={{ bottom: height - g.barCenterY + tabsLayout.barPlus.height, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }} onDismiss={() => setMenu(null)} /> : null}
      {menu === "chip" ? (
        <Menu
          items={[{ label: "Close Incognito Tabs", icon: "xmark", destructive: true, onPress: confirmLeaveIncognito }]}
          place={{ top: g.safeTop + tabsLayout.chipHeight + tabsLayout.headerGap * 2, left: (width - tabsLayout.menuWidth) / 2, width: tabsLayout.menuWidth }}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { position: "absolute", left: 0, right: 0, top: 0 },
  bar: { position: "absolute", left: 0, right: 0 },
});
