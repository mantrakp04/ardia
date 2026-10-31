import { OutsidePressArea, reduceMotion, Surface } from "../ui";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Animated, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { hex, useTheme } from "../ui/theme";
import { useWindowId, useWindowUi } from "../../state/browser/hooks";
import { closePanel } from "../../state/windows/actions";
import { useActiveTabIdWhile, useCommandBarCentred, useTabHasUrlWhile } from "../../state/omnibox/hooks";
import { usePage } from "../../state/tabs/pageState";
import { dismissHover, setRowsCovered } from "../../state/sidebar/hover";
import { useCardAnchors, useUrlAnchors } from "../../state/windows/layout";
import { barWidth } from "../ntp/NewTabPage";
import { closeNewTabBar } from "../../state/omnibox/newTabBar";
import type { NewTabTarget } from "../../state/browser/types";
import { Omnibox } from "./Omnibox";
import { BAR, PANEL_TEXT_LEFT, GROW } from "./tokens";
import { closePanelToHeroBar, type BarDismissal } from "../../state/omnibox/barState";
import { insecureLevel, urlTextLeft } from "../toolbar/Toolbar";
import { useToolbarRow } from "../toolbar/useToolbarRow";
import { compactLift, urlFieldOf } from "../../lib/toolbarRow";
import { shadow } from "../ui/tokens";

const RIGHT_OF_URL = 40;
const ABOVE_PANE = 5.5;
const PANEL_RADIUS = 20;
const MIN_WIDTH = 420;
const WINDOW_MARGIN = 12;
const DROPDOWN_MIN_WIDTH = 350;
const DROPDOWN_PAST_FIELD = 137;
const DROPDOWN_RADIUS = 12;
const PANEL_OPEN_HEIGHT = 107;
const CENTRED_TOP_SHARE = 0.22;

type Box = { left: number; top: number; width: number; height: number };

export function CommandPanel({ windowWidth }: { windowWidth: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { panel } = useWindowUi();
  const activeId = useActiveTabIdWhile(windowId, panel.open);
  const hasField = useTabHasUrlWhile(activeId, panel.open);
  const insecure = usePage(activeId, (p) => !!insecureLevel(p));
  const anchor = useUrlAnchors((s) => (panel.open ? s[windowId] : undefined));
  const centred = useCommandBarCentred(windowId, panel.open && !panel.newTab);
  const card = useCardAnchors((s) => (panel.newTab || centred ? s[windowId] : undefined));
  const toolbarRow = useToolbarRow();
  const overRows = panel.open && !panel.newTab && !centred && !!anchor?.sidebar;
  useEffect(() => {
    if (panel.open) dismissHover();
    setRowsCovered(windowId, overRows);
  }, [panel.open, overRows, windowId]);
  if (!panel.open || !activeId) return null;
  if (panel.newTab) return card ? <CentredBar windowId={windowId} tabId={activeId} target={panel.newTab} card={card} /> : null;

  const room = (left: number, fallback: number) => (windowWidth > 0 ? windowWidth - left - WINDOW_MARGIN : fallback);
  const onCancel = () => closePanel(windowId);
  const onDone = (reason?: BarDismissal) => closePanelToHeroBar(windowId, activeId, reason);
  const surface = (radius: number) => panelSurface(theme, radius);

  if (centred && card) {
    return (
      <Grow from={null} frame={centredFrame(card)} openHeight={PANEL_OPEN_HEIGHT} radius={PANEL_RADIUS} surface={surface(PANEL_RADIUS)}>
        <OutsidePressArea onOutsidePress={onCancel}>
          <Omnibox key={activeId} variant="panel" floating tabId={activeId} initialText={panel.initialText} onCancel={onCancel} onDone={onDone} />
        </OutsidePressArea>
      </Grow>
    );
  }
  if (!anchor) return null;

  if (anchor.sidebar) {
    const shown = anchor.left >= 0;
    const left = shown ? anchor.left : WINDOW_MARGIN;
    const width = Math.min(Math.max(DROPDOWN_MIN_WIDTH, anchor.width + DROPDOWN_PAST_FIELD), room(left, DROPDOWN_MIN_WIDTH));
    const from = shown ? { left, top: anchor.top, width: anchor.width, height: anchor.sidebar.height } : null;
    return (
      <Grow from={from} frame={{ left, top: anchor.top, width }} openHeight={anchor.sidebar.height} radius={DROPDOWN_RADIUS} surface={surface(DROPDOWN_RADIUS)}>
        <OutsidePressArea onOutsidePress={onCancel}>
          <Omnibox key={activeId} variant="sidebar" tabId={activeId} initialText={panel.initialText} onCancel={onCancel} onDone={onDone} />
        </OutsidePressArea>
      </Grow>
    );
  }

  const left = Math.max(WINDOW_MARGIN, anchor.left + urlTextLeft(insecure) - PANEL_TEXT_LEFT);
  const top = Math.max(0.5, anchor.top - ABOVE_PANE);
  const covering = anchor.left + anchor.width + RIGHT_OF_URL - left;
  const width = Math.min(Math.max(covering, MIN_WIDTH), room(left, covering));
  const field = urlFieldOf(toolbarRow);
  const lift = compactLift(toolbarRow);
  const from = hasField ? { left: anchor.left, top: anchor.top + field.top, width: anchor.width, height: field.height } : null;
  return (
    <Grow from={from} frame={{ left, top, width }} openHeight={PANEL_OPEN_HEIGHT - 2 * lift} radius={PANEL_RADIUS} surface={surface(PANEL_RADIUS)}>
      <OutsidePressArea onOutsidePress={onCancel}>
        <Omnibox key={activeId} variant="panel" tabId={activeId} initialText={panel.initialText} fieldRowHeight={BAR.panel.height - 2 * lift} onCancel={onCancel} onDone={onDone} />
      </OutsidePressArea>
    </Grow>
  );
}

function panelSurface(theme: ReturnType<typeof useTheme>, radius: number) {
  return {
    fill: hex(theme.ntpBarSolid),
    cornerRadius: radius,
    borderColor: hex(theme.ntpBarBorder),
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: shadow.dialog.color,
    shadowOpacity: theme.panelShadowOpacity,
    shadowRadius: shadow.dialog.radius,
    shadowOffset: shadow.dialog.offset,
  };
}

function centredFrame(card: Box) {
  const width = barWidth(card.width);
  const left = card.left + (card.width - width) / 2;
  const top = card.top + Math.max(WINDOW_MARGIN, Math.round(card.height * CENTRED_TOP_SHARE));
  return { left, top, width };
}

function CentredBar({ windowId, tabId, target, card }: { windowId: string; tabId: string; target: NewTabTarget; card: Box }) {
  const theme = useTheme();
  const onCancel = () => closePanel(windowId);
  const onDone = () => closeNewTabBar(windowId);
  return (
    <Grow
      from={null}
      frame={centredFrame(card)}
      openHeight={PANEL_OPEN_HEIGHT}
      radius={PANEL_RADIUS}
      surface={panelSurface(theme, PANEL_RADIUS)}
    >
      <OutsidePressArea onOutsidePress={onCancel}>
        <Omnibox key={`newTab:${target.kind}`} variant="panel" floating tabId={tabId} opensTab={target} onCancel={onCancel} onDone={onDone} />
      </OutsidePressArea>
    </Grow>
  );
}

function Grow({
  from,
  frame,
  openHeight,
  radius,
  surface,
  children,
}: {
  from: Box | null;
  frame: { left: number; top: number; width: number };
  openHeight: number;
  radius: number;
  surface: Omit<ComponentProps<typeof Surface>, "style">;
  children: ReactNode;
}) {
  const fade = !!from && !!reduceMotion();
  const [progress] = useState(() => new Animated.Value(from ? 0 : 1));
  const start = useRef(fade ? null : from);
  const [height, setHeight] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    if (height === null) setHeight(e.nativeEvent.layout.height);
  };
  useEffect(() => {
    if (!from || height === null) return;
    Animated.timing(progress, { toValue: 1, ...GROW, useNativeDriver: true }).start();
  }, [height === null]);

  const box = start.current;
  let outer: object = fade ? { opacity: progress } : {};
  let inner: object = {};
  if (box) {
    const h = height ?? openHeight;
    const at = (v: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [v, 1] });
    const shift = (v: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [v, 0] });
    const scaleX = at(box.width / frame.width);
    const scaleY = at(box.height / h);
    const x = shift(box.left + box.width / 2 - (frame.left + frame.width / 2));
    const y = shift(box.top + box.height / 2 - (frame.top + h / 2));
    outer = { transform: [{ translateX: x }, { translateY: y }, { scaleX }, { scaleY }] };
    inner = {
      transform: [
        { scaleX: Animated.divide(1, scaleX) },
        { scaleY: Animated.divide(1, scaleY) },
        { translateX: Animated.multiply(x, -1) },
        { translateY: Animated.multiply(y, -1) },
      ],
    };
  }
  return (
    <Animated.View onLayout={onLayout} style={[{ position: "absolute", ...frame }, outer]}>
      <Surface {...surface} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={box ? { overflow: "hidden", borderRadius: radius } : undefined}>
        <Animated.View style={inner}>{children}</Animated.View>
      </View>
    </Animated.View>
  );
}
