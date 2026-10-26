import { Symbol } from "@ardia/shell";
import { useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { useHover } from "../primitives";
import { TooltipAbove } from "../TooltipAbove";
import { dotGlyph, type DotGlyph } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const CELL = 12;
const DOT = 6;
const ICON_CELL = 18;
const ICON_BOX = 16;
const SYMBOL_SIZE = 13;
const TEXT_SIZE = 12;
const BAND = 28;
const SELECTED = 0.85;
const HOVERED = 0.4;
const IDLE = 0.2;
const DOT_CENTER_TO_TOOLTIP = 18.25;

export function useProfileDotsShown() {
  const incognito = useIsIncognito();
  const count = useBrowser((s) => s.profileOrder.length);
  return !incognito && count > 1;
}

export function ProfileDots({ windowId }: { windowId: string }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <View style={{ marginTop: (PROFILE_DOTS_HEIGHT - 3 - BAND) / 2, height: BAND, flexDirection: "row" }}>
        {ids.map((id) => (
          <Dot key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} />
        ))}
      </View>
    </View>
  );
}

function Dot({ id, windowId, page, pos }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value }) {
  const theme = useTheme();
  const name = useBrowser((s) => s.profiles[id]?.name ?? "");
  const icon = useBrowser((s) => s.profiles[id]?.icon ?? null);
  const showIcons = useBrowser((s) => s.settings.profileIconsInSidebar);
  const glyph = dotGlyph({ name, icon }, showIcons);
  const cell = glyph.kind === "dot" ? CELL : ICON_CELL;
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps}>
      <TooltipAbove text={name} active={hovered && !pressed} centerX={cell / 2} bottom={BAND / 2 + DOT_CENTER_TO_TOOLTIP} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        onPress={() => {
          setPressed(true);
          switchProfile(windowId, id, true);
        }}
      >
        <View style={{ width: cell, height: BAND, alignItems: "center", justifyContent: "center" }}>
          <DotMark glyph={glyph} color={theme.dark ? "#FFFFFF" : "#000000"} opacity={opacity} />
        </View>
      </Pressable>
    </View>
  );
}

function DotMark({ glyph, color, opacity }: { glyph: DotGlyph; color: string; opacity: number | Animated.AnimatedInterpolation<number> }) {
  if (glyph.kind === "symbol") {
    return (
      <Animated.View style={{ opacity }}>
        <Symbol name={glyph.name} size={SYMBOL_SIZE} weight="semibold" color={color} style={{ width: ICON_BOX, height: ICON_BOX }} />
      </Animated.View>
    );
  }
  if (glyph.kind === "text") {
    return (
      <Animated.Text numberOfLines={1} style={{ width: ICON_BOX, height: ICON_BOX, lineHeight: ICON_BOX, fontSize: TEXT_SIZE, fontWeight: "600", textAlign: "center", color, opacity }}>
        {glyph.text}
      </Animated.Text>
    );
  }
  return <Animated.View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: color, opacity }} />;
}
