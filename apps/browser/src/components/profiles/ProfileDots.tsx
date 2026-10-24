import { ContextMenuArea, showMenu, Symbol } from "@ardia/shell";
import { Animated, Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";
import { openSettings } from "../settings/windows";
import { useSidebarWidth } from "../sidebar/tokens";
import { iconMenuItems, profileSymbol } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const ICON_CELL = 22;
const ICON = 13;
const ICON_HOVERED = 0.7;
const ICON_IDLE = 0.45;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function profileDotsLayout(icons: (string | null)[], room: number) {
  const withIcons = icons.reduce((sum, icon) => sum + (icon ? ICON_CELL : CELL), 0);
  if (withIcons <= room) return { icons, cell: CELL, dot: DOT };
  const cell = Math.min(CELL, room / icons.length);
  return { icons: icons.map(() => null), cell, dot: Math.min(DOT, Math.max(2, cell - 4)) };
}

export function ProfileDots({ windowId, sideRoom }: { windowId: string; sideRoom: number }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const icons = useBrowser(useShallow((s) => s.profileOrder.map((id) => s.profiles[id]?.icon ?? null)));
  const width = useSidebarWidth(windowId);
  const { pages, pager } = usePagerPages(windowId);
  const fit = profileDotsLayout(icons, width - 2 * sideRoom);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {ids.map((id, i) => (
          <Dot
            key={id}
            id={id}
            windowId={windowId}
            icon={fit.icons[i] ?? null}
            cell={fit.cell}
            dot={fit.dot}
            page={pages.find((p) => p.id === id)}
            pos={pager.pos}
          />
        ))}
      </View>
    </View>
  );
}

type DotProps = { id: string; windowId: string; icon: string | null; cell: number; dot: number; page: PagerPage | undefined; pos: Animated.Value };

function Dot({ id, windowId, icon, cell, dot, page, pos }: DotProps) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const symbol = profileSymbol(icon);
  const { hovered, hoverProps } = useHover();
  const ink = theme.dark ? "#FFFFFF" : "#000000";
  const rest = icon ? (hovered ? ICON_HOVERED : ICON_IDLE) : hovered ? HOVERED : IDLE;
  const selected = icon ? 1 : SELECTED;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, selected, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps} tooltip={name}>
      <ContextMenuArea onContextMenu={() => void openDotMenu(id)}>
        <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => switchProfile(windowId, id, true)}>
          <View style={{ width: icon ? ICON_CELL : cell, height: BAND, alignItems: "center", justifyContent: "center" }}>
            <Animated.View style={{ opacity }}>
              {symbol ? (
                <Symbol name={symbol} size={ICON} weight="semibold" color={ink} style={{ width: ICON_CELL, height: BAND }} />
              ) : icon ? (
                <Text style={{ fontSize: ICON }}>{icon}</Text>
              ) : (
                <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: ink }} />
              )}
            </Animated.View>
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

async function openDotMenu(id: string) {
  const icon = useBrowser.getState().profiles[id]?.icon ?? null;
  const choice = await showMenu([
    { id: "icon", title: "Icon", symbol: "face.smiling", children: iconMenuItems(icon) },
    { separator: true },
    { id: "edit", title: "Edit Profile…", symbol: "pencil" },
  ]);
  if (choice?.startsWith("icon:")) useBrowser.getState().updateProfile(id, { icon: choice.slice("icon:".length) || null });
  else if (choice === "edit") openSettings("profiles", id);
}
