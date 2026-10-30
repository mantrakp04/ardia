import { useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { layout, useTheme } from "../ui/theme";
import { useIsIncognito, useProfile, useSettings } from "../../state/browser/hooks";
import { useProfileOrder, useProfileRecords } from "../../state/profiles/hooks";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { ContextMenuArea, useHover } from "../ui";
import { TooltipAbove } from "../ui/TooltipAbove";
import { SIDEBAR_FOOTER_DOWNLOADS } from "../sidebar/geometry";
import { switcherCellWidth, switcherIcons, SwitcherMark } from "./ProfileIcons";
import { openProfileItemMenu } from "./profileMenu";
import { profileSwitcher } from "./tokens";

export const PROFILE_DOTS_HEIGHT = profileSwitcher.height;
const { band: BAND, dotTooltipLift } = profileSwitcher;
const SIDE_ROOM = layout.sidebarInset + SIDEBAR_FOOTER_DOWNLOADS.size + 4;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useProfileOrder((o) => o.length);
  return !incognito && count > 1;
}

export function useProfileFooterShown() {
  return !useIsIncognito();
}

export function ProfileDots({ windowId, width }: { windowId: string; width: number }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const saved = useProfileRecords(useShallow((profiles) => ids.map((id) => profiles[id]?.icon ?? null)));
  const shown = useSettings((s) => s.profileSwitcherIcons);
  const icons = switcherIcons(saved, shown, width - 2 * SIDE_ROOM);
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
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
  return (
    <View {...hoverProps}>
      <TooltipAbove text={name} active={hovered && !pressed} centerX={cell / 2} bottom={BAND / 2 + dotTooltipLift} />
      <ContextMenuArea onContextMenu={() => void openProfileItemMenu(id, "sidebar", windowId)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={() => {
            setPressed(true);
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
