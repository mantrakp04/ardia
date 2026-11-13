import { useLayoutEffect, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, View, type GestureResponderEvent } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { noteSwitcherPress } from "../../state/telemetry/switcherPresses";
import { layout, useTheme } from "../ui/theme";
import { useIsIncognito, useProfile, useSettings } from "../../state/browser/hooks";
import { useProfileOrder, useProfileRecords } from "../../state/profiles/hooks";
import { dropSwitcherProfile, switcherDragStarts, switcherDropSlot, switcherLanding, switcherLift, switcherShift, tickSwitcherSlot } from "../../state/profiles/switcherReorder";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { ContextMenuArea, useHover } from "../ui";
import { TooltipAbove } from "../ui/TooltipAbove";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { switcherCellWidth, switcherIcons, SwitcherMark } from "./ProfileIcons";
import { openProfileItemMenu } from "./profileMenu";
import { profileSwitcher, switcherMotion } from "./tokens";

export const PROFILE_DOTS_HEIGHT = profileSwitcher.height;
const { band: BAND, dotTooltipLift } = profileSwitcher;
const SIDE_ROOM = layout.sidebarInset;
const SIDE_ROOM_BESIDE_DOWNLOADS = SIDEBAR_FOOTER_DOWNLOADS.left + SIDEBAR_FOOTER_DOWNLOADS.size + 4;

const slide = (value: Animated.Value, toValue: number) => Animated.timing(value, { toValue, ...switcherMotion.slide, useNativeDriver: true });

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useProfileOrder((o) => o.length);
  return !incognito && count > 1;
}

type WithHistory = GestureResponderEvent & { touchHistory?: { touchBank: ({ startPageX: number } | null | undefined)[] } };

const pressStartX = (e: GestureResponderEvent) => (e as WithHistory).touchHistory?.touchBank[Number(e.nativeEvent.identifier)]?.startPageX ?? e.nativeEvent.pageX;

type DotDrag = { start(id: string): void; move(dx: number): void; end(commit: boolean): void };

export function ProfileDots({ windowId, width, besideDownloads }: { windowId: string; width: number; besideDownloads: boolean }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const saved = useProfileRecords(useShallow((profiles) => ids.map((id) => profiles[id]?.icon ?? null)));
  const shown = useSettings((s) => s.profileSwitcherIcons);
  const icons = switcherIcons(saved, shown, width - 2 * (besideDownloads ? SIDE_ROOM_BESIDE_DOWNLOADS : SIDE_ROOM));
  const { pages, pager } = usePagerPages(windowId);
  const offsets = useRef(new Map<string, Animated.Value>()).current;
  const offsetOf = (id: string) => {
    let v = offsets.get(id);
    if (!v) offsets.set(id, (v = new Animated.Value(0)));
    return v;
  };
  const [lifted, setLifted] = useState<string | null>(null);
  const row = useRef({ ids, widths: icons.map(switcherCellWidth) });
  row.current = { ids, widths: icons.map(switcherCellWidth) };
  const drag = useRef({ id: "", from: 0, to: 0, lift: 0, widths: [] as number[], landing: null as { id: string; residual: number } | null });

  useLayoutEffect(() => {
    const landing = drag.current.landing;
    if (!landing) return;
    drag.current.landing = null;
    offsets.forEach((v, id) => v.setValue(id === landing.id ? landing.residual : 0));
    slide(offsetOf(landing.id), 0).start();
  }, [ids]);

  const controller = useRef<DotDrag>({
    start(id) {
      const { ids: order, widths } = row.current;
      const from = order.indexOf(id);
      drag.current = { id, from, to: from, lift: 0, widths, landing: null };
      setLifted(id);
    },
    move(dx) {
      const { id, from, widths } = drag.current;
      if (from < 0) return;
      drag.current.lift = switcherLift(widths, from, dx);
      offsetOf(id).setValue(drag.current.lift);
      const to = switcherDropSlot(widths, from, dx);
      if (to === drag.current.to) return;
      drag.current.to = to;
      tickSwitcherSlot();
      row.current.ids.forEach((other, j) => {
        if (other !== id) slide(offsetOf(other), switcherShift(widths, from, to, j)).start();
      });
    },
    end(commit) {
      const { id, from, to, lift, widths } = drag.current;
      setLifted(null);
      if (commit && from >= 0 && from !== to) {
        drag.current.landing = { id, residual: lift - switcherLanding(widths, from, to) };
        if (dropSwitcherProfile(id, to)) return;
        drag.current.landing = null;
      }
      offsets.forEach((v) => slide(v, 0).start());
    },
  }).current;

  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {ids.map((id, i) => (
          <Dot
            key={id}
            id={id}
            windowId={windowId}
            icon={icons[i] ?? null}
            page={pages.find((p) => p.id === id)}
            pos={pager.pos}
            offset={offsetOf(id)}
            lifted={lifted === id}
            dragging={lifted !== null}
            drag={controller}
          />
        ))}
      </View>
    </View>
  );
}

function Dot({
  id,
  windowId,
  icon,
  page,
  pos,
  offset,
  lifted,
  dragging,
  drag,
}: {
  id: string;
  windowId: string;
  icon: string | null;
  page: PagerPage | undefined;
  pos: Animated.Value;
  offset: Animated.Value;
  lifted: boolean;
  dragging: boolean;
  drag: DotDrag;
}) {
  const theme = useTheme();
  useNativePagerPosition(windowId);
  const name = useProfile(id, (p) => p?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const levels = icon ? profileSwitcher.icons : profileSwitcher.dots;
  const rest = hovered || lifted ? levels.hovered : levels.idle;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, levels.selected, rest], extrapolate: "clamp" })
    : rest;
  const cell = switcherCellWidth(icon);
  const mark = useRef<View>(null);
  const origin = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => switcherDragStarts(g.dx, g.dy),
      onPanResponderGrant: (e) => {
        origin.current = pressStartX(e);
        drag.start(id);
        drag.move(e.nativeEvent.pageX - origin.current);
      },
      onPanResponderMove: (e) => drag.move(e.nativeEvent.pageX - origin.current),
      onPanResponderRelease: (e) => {
        drag.move(e.nativeEvent.pageX - origin.current);
        drag.end(true);
      },
      onPanResponderTerminate: () => drag.end(false),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  return (
    <Animated.View {...hoverProps} {...pan.panHandlers} ref={mark} style={{ zIndex: lifted ? 1 : 0, transform: [{ translateX: offset }] }}>
      <TooltipAbove text={name} active={hovered && !pressed && !dragging} centerX={cell / 2} bottom={BAND / 2 + dotTooltipLift} />
      <ContextMenuArea onContextMenu={() => void openProfileItemMenu(id, "sidebar", windowId, mark.current)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={() => {
            setPressed(true);
            noteSwitcherPress(windowId, id, !!icon);
            switchProfile(windowId, id, true);
          }}
        >
          <View style={{ width: cell, height: BAND, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={{ opacity }}>
              <SwitcherMark icon={icon} color={theme.mark} />
            </Animated.View>
          </View>
        </Pressable>
      </ContextMenuArea>
    </Animated.View>
  );
}
