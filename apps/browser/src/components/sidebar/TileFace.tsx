import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { DockSelection, radius, Surface } from "../ui";
import { hex, layout, useTheme } from "../ui/theme";
import { useTileTheme, type TileTheme } from "../../state/favicons/tileTheme";
import { useTab } from "../../state/browser/hooks";
import { GlassFill, useGlass } from "../ui/Glass";
import { SLIDE } from "../tabstrip/stripReorder";
import { TabBadges } from "../media/TabBadges";
import { TabIcon } from "./TabIcon";
import { sidebarTokens, TILE_GLOW, useSidebarTokens } from "./tokens";

const SELECTION_STROKE = 3;
const GLASS_RING = 2;
export const TILE_RADIUS = radius.card;

type FaceState = { width: number; active: boolean; selected: boolean; hovered: boolean; pressed: boolean };

export function TileFace({ tabId, badge, ...state }: FaceState & { tabId: string; badge?: ReactNode }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  const glass = useGlass();
  if (!tab) return null;
  const { width, active } = state;
  const icon = (
    <View>
      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
      <TabBadges tabId={tabId} />
    </View>
  );
  if (glass)
    return (
      <GlassTile {...state} tileTheme={tileTheme}>
        {icon}
        {badge}
      </GlassTile>
    );
  if (active && tileTheme)
    return (
      <DockSelection
        image={tileTheme.image}
        emoji={tileTheme.emoji}
        theme={tileTheme.theme.kind}
        fill={tileTheme.theme.kind === "template" ? tileTheme.theme.fill : undefined}
        stroke={tileTheme.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
        cornerRadius={TILE_RADIUS}
        strokeWidth={SELECTION_STROKE}
        dark={theme.dark}
        style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}
      >
        {tileTheme.theme.kind === "template" ? (
          <View>
            <View style={{ width: 16, height: 16 }} />
            <TabBadges tabId={tabId} />
          </View>
        ) : (
          icon
        )}
        {badge}
      </DockSelection>
    );
  if (active)
    return (
      <Surface
        fill={hex(theme.pinnedSelectedRim)}
        cornerRadius={TILE_RADIUS}
        shadowColor={sidebarTokens(theme).tileGlow}
        shadowOpacity={theme.dark ? TILE_GLOW.opacity.dark : TILE_GLOW.opacity.light}
        shadowRadius={TILE_GLOW.radius}
        shadowOffset={TILE_GLOW.offset}
        style={{ width, height: layout.pinnedHeight, padding: 1 }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: TILE_RADIUS - 1,
            backgroundColor: theme.pinnedSelectedFill,
            borderTopWidth: 1,
            borderColor: theme.pinnedSelectedOutline,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
        {badge}
      </Surface>
    );
  return (
    <RestingTile {...state}>
      {icon}
      {badge}
    </RestingTile>
  );
}

export function RestingTile({ width, selected, hovered, pressed, children }: Omit<FaceState, "active"> & { children: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  if (useGlass())
    return (
      <GlassTile width={width} active={false} selected={selected} hovered={hovered} pressed={pressed} tileTheme={null}>
        {children}
      </GlassTile>
    );
  return (
    <View
      style={{
        width,
        height: layout.pinnedHeight,
        borderRadius: TILE_RADIUS,
        borderWidth: selected ? 1 : StyleSheet.hairlineWidth,
        borderColor: selected ? tokens.dragBorder : theme.pinnedRestingStroke,
        backgroundColor: pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

function GlassTile({ width, active, selected, hovered, pressed, tileTheme, children }: FaceState & { tileTheme: TileTheme | null; children: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  return (
    <View style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}>
      <GlassFill radius={TILE_RADIUS} state={pressed ? "pressed" : active ? "active" : hovered || selected ? "lit" : "rest"} />
      {active ? (
        <DockSelection
          image={tileTheme?.image}
          emoji={tileTheme?.emoji}
          theme={tileTheme?.theme.kind}
          fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
          cornerRadius={TILE_RADIUS}
          strokeWidth={GLASS_RING}
          dark={theme.dark}
          glass
          colorRing
          style={StyleSheet.absoluteFill}
        />
      ) : selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: TILE_RADIUS, borderWidth: 1, borderColor: tokens.dragBorder }]} />
      ) : null}
      {children}
    </View>
  );
}

const RING_OUTSET = 3;

export function FolderDropRing({ on }: { on: boolean }) {
  const theme = useTheme();
  const shown = useMemo(() => new Animated.Value(on ? 1 : 0), []);
  useEffect(() => {
    const spring = Animated.spring(shown, { toValue: on ? 1 : 0, ...SLIDE });
    spring.start();
    return () => spring.stop();
  }, [on, shown]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: -RING_OUTSET,
        right: -RING_OUTSET,
        top: -RING_OUTSET,
        bottom: -RING_OUTSET,
        borderRadius: TILE_RADIUS + RING_OUTSET,
        borderWidth: 2,
        borderColor: theme.accent,
        backgroundColor: sidebarTokens(theme).folderDropFill,
        opacity: shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    />
  );
}

export function useSlotPosition(x: number, y: number, width: number, sliding: boolean, dragging: boolean) {
  const position = useMemo(() => new Animated.ValueXY({ x, y }), []);
  const placedWidth = useRef(width);
  useLayoutEffect(() => {
    if (dragging) return;
    const resized = placedWidth.current !== width;
    placedWidth.current = width;
    if (sliding && !resized) Animated.spring(position, { toValue: { x, y }, ...SLIDE }).start();
    else position.setValue({ x, y });
  }, [x, y, width, sliding, dragging, position]);
  useEffect(() => () => position.stopAnimation(), [position]);
  return position;
}
