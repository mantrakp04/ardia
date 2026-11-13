import { useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { noteSwitcherPress } from "../../state/telemetry/switcherPresses";
import { useTheme } from "../ui/theme";
import { useIsIncognito, useProfile, useSettings } from "../../state/browser/hooks";
import { useProfileOrder, useProfileRecords } from "../../state/profiles/hooks";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { capsule, ContextMenuArea, useHover } from "../ui";
import { GlassFill, useGlass } from "../ui/Glass";
import { TooltipAbove } from "../ui/TooltipAbove";
import { switcherCellWidth, switcherIcons, SwitcherMark } from "./ProfileIcons";
import { switcherCapsuleEnds, switcherRoom } from "./switcherBand";
import { openProfileItemMenu } from "./profileMenu";
import { profileSwitcher } from "./tokens";

export const PROFILE_DOTS_HEIGHT = profileSwitcher.height;
const { band: BAND, dotTooltipLift } = profileSwitcher;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useProfileOrder((o) => o.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId, width, besideDownloads }: { windowId: string; width: number; besideDownloads: boolean }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const saved = useProfileRecords(useShallow((profiles) => ids.map((id) => profiles[id]?.icon ?? null)));
  const shown = useSettings((s) => s.profileSwitcherIcons);
  const glass = useGlass();
  const room = switcherRoom(width, besideDownloads);
  const icons = switcherIcons(saved, shown, room);
  const ends = glass ? switcherCapsuleEnds(icons, room) : null;
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row", paddingLeft: ends?.left ?? 0, paddingRight: ends?.right ?? 0 }}>
        {ends ? <GlassFill radius={capsule(BAND)} /> : null}
        {ids.map((id, i) => (
          <Dot key={id} id={id} windowId={windowId} icon={icons[i] ?? null} page={pages.find((p) => p.id === id)} pos={pager.pos} />
        ))}
      </View>
    </View>
  );
}

function Dot({ id, windowId, icon, page, pos }: { id: string; windowId: string; icon: string | null; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  useNativePagerPosition(windowId);
  const name = useProfile(id, (p) => p?.name ?? "");
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const levels = icon ? profileSwitcher.icons : profileSwitcher.dots;
  const rest = hovered ? levels.hovered : levels.idle;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, levels.selected, rest], extrapolate: "clamp" })
    : rest;
  const cell = switcherCellWidth(icon);
  const mark = useRef<View>(null);
  return (
    <View {...hoverProps} ref={mark}>
      <TooltipAbove text={name} active={hovered && !pressed} centerX={cell / 2} bottom={BAND / 2 + dotTooltipLift} />
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
    </View>
  );
}
