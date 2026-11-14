import { useEffect, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { neighbours } from "../../lib/pagerPhysics";
import { useSystemBars } from "../../state/app/systemBars";
import { useFrozenOrder, useNavigation, usePageTone } from "../../state/browse/hooks";
import { closePageMenu, openPageMenu } from "../../state/page/actions";
import { useFindOpen, useMenuOpen, useReaderTabId } from "../../state/page/hooks";
import { captureCurrentCover, newTab, showDeck, swipeOrder, switchToNeighbour } from "../../state/browse/store";
import { useSearchOpen } from "../../state/search/hooks";
import { closeFrontTab, menuOpenedHaptic, recentTabs, switchToTab, tabTitle } from "../../state/browse/tabMenus";
import { useDeckOrder } from "../../state/tabs/hooks";
import type { BrowserTab } from "../../state/tabs/tabModels";
import {
  barCenterFromBottom,
  barHeight,
  browseLayout,
  isDarkColor,
  LoadingLine,
  Menu,
  pageBottomInset,
  rolesFor,
  space,
  tabsInk,
  tabsLayout,
  tabsMotion,
  usePresence,
  useTheme,
  type MenuItem,
} from "../ui";
import { BottomBar } from "./BottomBar";
import { FindBar } from "./FindBar";
import { PageMenu } from "./PageMenu";
import { PageRequestHost, PressMenu } from "./PageRequests";
import { ReaderView } from "./ReaderView";
import { PageSurface } from "./PageSurface";
import { PagerBlack, PagerNeighbour, useTabPager } from "./TabPager";

export function BrowsingScreen({ tab }: { tab: BrowserTab }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const menuOpen = useMenuOpen();
  const finding = useFindOpen();
  const readerId = useReaderTabId();
  const tone = usePageTone(tab.id);
  const progress = useNavigation(tab.id, (n) => n?.progress ?? 0);
  const isLoading = useNavigation(tab.id, (n) => n?.isLoading ?? true);
  const order = useDeckOrder();
  const frozen = useFrozenOrder();
  const searching = useSearchOpen();
  const [tabsMenu, setTabsMenu] = useState(false);
  const menu = usePresence(menuOpen);
  useEffect(() => closePageMenu, [tab.id]);
  const byId = useMemo(() => new Map(order.map((t) => [t.id, t])), [order]);
  const around = useMemo(() => neighbours(swipeOrder(), tab.id), [order, frozen, tab.id]);
  const left = around.left ? (byId.get(around.left) ?? null) : null;
  const right = around.right ? (byId.get(around.right) ?? null) : null;
  const pager = useTabPager({
    width,
    selectedId: tab.id,
    left: left?.id ?? null,
    right: right?.id ?? null,
    onCommit: switchToNeighbour,
    onGrab: captureCurrentCover,
  });
  const top = tone?.top ?? theme.surface;
  const bottom = tone?.bottom ?? theme.surface;
  const barDark = isDarkColor(bottom);
  useSystemBars(isDarkColor(top), barDark);
  const statusStyle = useAnimatedStyle(() => ({ backgroundColor: withTiming(top, { duration: tabsMotion.barTone }) }), [top]);
  const barStyle = useAnimatedStyle(() => ({ backgroundColor: withTiming(bottom, { duration: tabsMotion.barTone }) }), [bottom]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}>
      <PagerBlack />
      <Animated.View style={[StyleSheet.absoluteFill, styles.outgoing, { backgroundColor: theme.surface }, pager.outgoing]}>
        <Animated.View style={[{ height: insets.top }, statusStyle]} />
        <View style={[styles.page, { marginBottom: pageBottomInset(insets.bottom) }]}>
          <PageSurface key={tab.id} tab={tab} />
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tabsInk.pagerBlack }, pager.dim]} pointerEvents="none" />
      </Animated.View>
      {left ? <PagerNeighbour pager={pager} tab={left} side={-1} width={width} statusHeight={insets.top} hasLeft hasRight={right !== null} /> : null}
      {right ? <PagerNeighbour pager={pager} tab={right} side={1} width={width} statusHeight={insets.top} hasLeft={left !== null} hasRight /> : null}
      <View style={[styles.loading, { top: insets.top }]} pointerEvents="none">
        <LoadingLine progress={progress} isLoading={isLoading} color={theme.accent} />
      </View>
      {finding ? (
        <FindBar tabId={tab.id} />
      ) : (
        <GestureDetector gesture={pager.gesture}>
          <Animated.View style={[styles.bar, { height: barHeight(insets.bottom) }, barStyle]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: barDark ? tabsInk.barShadeOnDark : tabsInk.barShadeOnLight }]} />
            <View style={[styles.controls, { bottom: barCenterFromBottom(insets.bottom) - browseLayout.hitTarget / 2 }]}>
              <BottomBar
                order={order}
                roles={rolesFor(barDark)}
                showsPlus={!searching}
                onTabs={showDeck}
                onTabsMenu={() => {
                  menuOpenedHaptic();
                  setTabsMenu(true);
                }}
                onPlus={newTab}
                onMore={openPageMenu}
              />
            </View>
          </Animated.View>
        </GestureDetector>
      )}
      {tabsMenu ? (
        <Menu
          items={tabsMenuItems(order)}
          place={{ bottom: barHeight(insets.bottom) + space.xs, left: space.l, width: Math.min(tabsLayout.menuWidth, width - space.l * 2) }}
          onDismiss={() => setTabsMenu(false)}
        />
      ) : null}
      <PressMenu width={width} height={height} />
      {menu.mounted ? <PageMenu tabId={tab.id} open={menuOpen} onHidden={menu.hidden} /> : null}
      {readerId === tab.id ? <ReaderView tabId={tab.id} /> : null}
      <PageRequestHost tabId={tab.id} />
    </View>
  );
}

function tabsMenuItems(order: BrowserTab[]): MenuItem[] {
  const others = recentTabs(order).map((tab): MenuItem => ({ label: tabTitle(tab), onPress: () => switchToTab(tab.id) }));
  return [...others, ...(others.length ? ["divider" as const] : []), { label: "Close Tab", icon: "xmark", destructive: true, onPress: closeFrontTab }];
}

const styles = StyleSheet.create({
  outgoing: { overflow: "hidden" },
  page: { flex: 1 },
  loading: { position: "absolute", left: 0, right: 0 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0 },
  controls: { position: "absolute", left: 0, right: 0 },
});
