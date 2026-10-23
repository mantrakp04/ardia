import { ContextMenuArea, DockSelection, MouseArea, Surface, Symbol } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { closeTab } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useTileTheme, type TileTheme } from "../../lib/tileTheme";
import { GlassFill, liquidGlass } from "../glass";
import { listTopGap, useAddressBarInSidebar } from "../layout/windowLayout";
import { SLIDE } from "../layout/stripReorder";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, useTab, useTabLive, useWindowId } from "../../store/hooks";
import { activeTabId } from "../../store/model";
import { NextMeetingBadge } from "../live/NextMeetingBadge";
import { clickTab } from "./actions";
import { PIN_SLOT, useDragController, useDragging, useDragItem, useDropPins, usePinBefore, usePinnedCount } from "./dnd";
import { dismissHover, useRowHover } from "./hover";
import { openTabMenu } from "./menus";
import { pinGrid, pinGridHeight, TILE_GAP } from "./pinZone";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { clickMods } from "./TabRow";
import { useSidebarTokens } from "./tokens";

const SELECTION_STROKE = 3;
const GLASS_RIM = 1;
const TILE_SPACING = { marginRight: TILE_GAP };

export const PinnedGrid = memo(function PinnedGrid({ tabs, innerWidth, flush = false }: { tabs: string[]; innerWidth: number; flush?: boolean }) {
  const controller = useDragController();
  const count = usePinnedCount(tabs);
  const { columns, width } = pinGrid(count, innerWidth);
  const before = usePinBefore();
  const marks = controller?.marks.getState();
  const tail = useDragItem("tail:tiles", { kind: "tail", tabIds: [], section: "tiles" });
  const dragging = useDragging();
  const addressBar = useAddressBarInSidebar();
  const topGap = listTopGap(addressBar);
  if (!tabs.length) return dragging && !addressBar && tail.gap ? <Animated.View style={{ height: tail.gap }} /> : null;
  let slot = 0;
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      style={{ marginTop: flush ? 0 : topGap }}
    >
      <View style={{ height: pinGridHeight(count, innerWidth, layout.pinnedHeight) }}>
        {tabs.map((id) => {
          const key = `t:${id}`;
          if (before === key) slot += marks?.pinCount ?? 0;
          const at = Math.min(slot, Math.max(0, count - 1));
          if (!marks?.sources.has(key)) slot++;
          return <PinnedTile key={id} tabId={id} width={width} x={(at % columns) * (width + TILE_GAP)} y={Math.floor(at / columns) * (layout.pinnedHeight + TILE_GAP)} />;
        })}
      </View>
      <Animated.View ref={tail.wrapper.ref} style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0 }} />
    </View>
  );
});

export function PinFieldZone({ top, height }: { top: number; height: number }) {
  const tokens = useSidebarTokens();
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      onLayout={() => void controller?.tilesLaidOut()}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        right: layout.sidebarInset,
        top,
        height,
        borderRadius: 10,
        borderWidth: active ? 1.5 : 1,
        borderStyle: "dashed",
        borderColor: active ? theme.accent : tokens.dragBorder,
        backgroundColor: tokens.dragSilhouette,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PinGlyph color={active ? theme.accent : theme.textSecondary} />
    </View>
  );
}

export function PinSlotZone() {
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  const gap = controller?.items.get("tail:tiles")?.gap;
  const opacity = gap ? gap.interpolate({ inputRange: [0, PIN_SLOT], outputRange: [0, 1], extrapolate: "clamp" }) : active ? 1 : 0;
  return (
    <>
      <View
        ref={(v) => {
          controller?.regions.set("tiles", v);
        }}
        onLayout={() => void controller?.tilesLaidOut()}
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: 0,
          height: active ? layout.pinnedTop + layout.pinnedHeight : layout.pinnedTop - layout.rowGap,
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: layout.pinnedTop,
          height: layout.pinnedHeight,
          opacity,
          borderRadius: 10,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: theme.accent,
          backgroundColor: theme.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PinGlyph color={theme.accent} />
      </Animated.View>
    </>
  );
}

function PinGlyph({ color }: { color: string }) {
  return <Symbol name="pin" size={13} color={color} style={{ width: 16, height: 16 }} />;
}

function backToPinnedUrl(windowId: string, tabId: string) {
  const s = useBrowser.getState();
  if (activeTabId(s, windowId) === tabId) s.returnToPinnedUrl(tabId);
}

const PinnedTile = memo(function PinnedTile({ tabId, width, x, y }: { tabId: string; width: number; x: number; y: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const selected = useBrowser((s) => (s.selection[windowId] ?? []).includes(tabId));
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  const { wrapper, handle, dragging } = useDragItem(`t:${tabId}`, { kind: "tile", tabIds: [tabId], section: "tiles" }, () => useBrowser.getState().selection[windowId] ?? []);
  const position = useMemo(() => new Animated.ValueXY({ x, y }), []);
  const hidden = useRef(dragging);
  useLayoutEffect(() => {
    if (dragging || hidden.current) position.setValue({ x, y });
    else Animated.spring(position, { toValue: { x, y }, ...SLIDE }).start();
    hidden.current = dragging;
  }, [x, y, dragging, position]);
  useEffect(() => () => position.stopAnimation(), [position]);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  if (!tab) return null;
  const radius = 10;

  return (
    <Animated.View ref={wrapper.ref} style={[TILE_SPACING, { position: "absolute", ...position.getLayout() }, wrapper.style]} {...handle}>
      <View
        ref={(v) => registerRow(windowId, tabId, v)}
        {...hoverProps}
        onDoubleClick={() => backToPinnedUrl(windowId, tabId)}
      >
        <MouseArea onMiddleClick={() => void closeTab(tabId)}>
          <ContextMenuArea
            onContextMenu={() => {
              dismissHover();
              void openTabMenu(windowId, tab);
            }}
          >
            <Pressable
              onPress={(e) => {
                dismissHover();
                clickTab(windowId, tabId, clickMods(e));
              }}
            >
              {({ pressed }) =>
                liquidGlass ? (
                  <GlassTile tabId={tabId} width={width} active={active} selected={selected} hovered={hovered} pressed={pressed} tileTheme={tileTheme} />
                ) : active && tileTheme ? (
                  <DockSelection
                    image={tileTheme.image}
                    emoji={tileTheme.emoji}
                    theme={tileTheme.theme.kind}
                    fill={tileTheme.theme.kind === "template" ? tileTheme.theme.fill : undefined}
                    stroke={tileTheme.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
                    cornerRadius={radius}
                    strokeWidth={SELECTION_STROKE}
                    dark={theme.dark}
                    style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}
                  >
                    <View>
                      {tileTheme.theme.kind === "template" ? (
                        <View style={{ width: 16, height: 16 }} />
                      ) : (
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                      )}
                      <TabBadges tabId={tabId} />
                    </View>
                  </DockSelection>
                ) : active ? (
                  <Surface
                    fill={hex(theme.pinnedSelectedRim)}
                    cornerRadius={radius}
                    shadowColor={theme.dark ? "#FFFFFF" : "#000000"}
                    shadowOpacity={theme.dark ? 0.15 : 0.12}
                    shadowRadius={1.5}
                    shadowOffset={[0, 0.5]}
                    style={{ width, height: layout.pinnedHeight, padding: 1 }}
                  >
                    <View
                      style={{
                        flex: 1,
                        borderRadius: radius - 1,
                        backgroundColor: theme.pinnedSelectedFill,
                        borderTopWidth: 1,
                        borderColor: theme.pinnedSelectedOutline,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <View>
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                        <TabBadges tabId={tabId} />
                      </View>
                    </View>
                  </Surface>
                ) : (
                  <View
                    style={{
                      width,
                      height: layout.pinnedHeight,
                      borderRadius: radius,
                      borderWidth: selected ? 1 : 0.5,
                      borderColor: selected ? tokens.dragBorder : theme.pinnedRestingStroke,
                      backgroundColor: pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View>
                      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                      <TabBadges tabId={tabId} />
                    </View>
                  </View>
                )
              }
            </Pressable>
          </ContextMenuArea>
        </MouseArea>
        <NextMeetingBadge tabId={tabId} />
        {playing || tab.muted ? (
          <View pointerEvents="none" style={{ position: "absolute", bottom: 3, right: 4 }}>
            <Symbol name={tab.muted ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={8} color={theme.textSecondary} style={{ width: 12, height: 10 }} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});

function GlassTile({
  tabId,
  width,
  active,
  selected,
  hovered,
  pressed,
  tileTheme,
}: {
  tabId: string;
  width: number;
  active: boolean;
  selected: boolean;
  hovered: boolean;
  pressed: boolean;
  tileTheme: TileTheme | null;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const tab = useTab(tabId);
  if (!tab) return null;
  const radius = 10;
  const fill = active ? theme.pinnedSelectedFill : pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting;
  return (
    <View style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}>
      <GlassFill radius={radius} fill={fill} raised={active && !pressed} />
      {active ? (
        <DockSelection
          image={tileTheme?.image}
          emoji={tileTheme?.emoji}
          theme={tileTheme?.theme.kind}
          fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
          cornerRadius={radius}
          strokeWidth={GLASS_RIM}
          dark={theme.dark}
          glass
          style={StyleSheet.absoluteFill}
        />
      ) : selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: tokens.dragBorder }]} />
      ) : null}
      <View>
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <TabBadges tabId={tabId} />
      </View>
    </View>
  );
}
