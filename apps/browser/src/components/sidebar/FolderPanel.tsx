import { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { layout, useTheme } from "../ui/theme";
import { useIsActiveTab, useTab } from "../../state/browser/hooks";
import { plural, tabTitle } from "../../state/browser/model";
import { useTileFolderLabel, useTileFolderMembers } from "../../state/pins/hooks";
import { SLIDE } from "../tabstrip/stripReorder";
import { ContextMenuArea, FadeLabel, font, OutsidePressArea, Panel, radius, useHover, weight } from "../ui";
import { SIDEBAR_SHADOW } from "./tokens";
import { clickTab } from "../../state/sidebar/actions";
import { useDragController, useDragItem, useFolderAway } from "./DragProvider";
import { openTabMenu } from "../../state/sidebar/menus";
import { TabIcon } from "./TabIcon";
import { closeFolderPanel, closeFolderPanelOnPress, closeFolderPanelWhenWindowMoves, openTileFolderMenu, useFolderPanel } from "../../state/sidebar/tileFolderUi";
import { tailKey } from "./dragModel";

const PANEL_GAP = 6;
const PANEL_PAD = 6;

type Frame = { x: number; y: number; w: number; h: number };

export function FolderPanel({ windowId }: { windowId: string }) {
  const open = useFolderPanel((u) => (u.open?.windowId === windowId ? u.open : null));
  if (!open) return null;
  return <PanelBody key={open.folderId} windowId={windowId} folderId={open.folderId} anchor={open.anchor} />;
}

function PanelBody({ windowId, folderId, anchor }: { windowId: string; folderId: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const theme = useTheme();
  const controller = useDragController();
  const members = useTileFolderMembers(windowId, folderId);
  const label = useTileFolderLabel(windowId, folderId);
  const away = useFolderAway();
  const [root, setRoot] = useState<Frame | null>(null);
  const shown = useMemo(() => new Animated.Value(0), []);
  const tail = useDragItem(tailKey("folder"), { kind: "tail", tabIds: [], section: "folder" });

  useEffect(() => {
    controller?.root?.measureInWindow((x, y, w, h) => setRoot({ x, y, w, h }));
  }, [controller]);
  useEffect(() => {
    if (!root) return;
    const spring = Animated.spring(shown, { toValue: 1, ...SLIDE });
    spring.start();
    return () => spring.stop();
  }, [root, shown]);
  useEffect(() => {
    if (!members.length) closeFolderPanel();
  }, [members.length]);
  useEffect(() => closeFolderPanelWhenWindowMoves(windowId), [windowId]);
  useEffect(
    () => () => {
      controller?.regions.delete("folder");
    },
    [controller],
  );
  if (!root) return null;

  return (
    <Animated.View
      ref={(v: View | null) => {
        controller?.regions.set("folder", v);
      }}
      pointerEvents={away ? "none" : "box-none"}
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        width: root.w - layout.sidebarInset * 2,
        top: anchor.y + anchor.height + PANEL_GAP - root.y,
        opacity: away ? 0 : shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    >
      <OutsidePressArea onOutsidePress={closeFolderPanelOnPress}>
        <Panel fill={theme.panel} radius={radius.panel} border={theme.panelBorder} shadow={SIDEBAR_SHADOW.card} style={{ padding: PANEL_PAD }}
        >
          <ContextMenuArea onContextMenu={() => void openTileFolderMenu(windowId, folderId)}>
            <Text numberOfLines={1} style={{ ...font.small, fontWeight: weight.semibold, color: theme.textSecondary, marginTop: 2, marginBottom: 6, marginHorizontal: 6 }}>
              {label} · {plural(members.length, "tab")}
            </Text>
          </ContextMenuArea>
          <View style={{ gap: layout.rowGap }}>
            {members.map((id) => (
              <MemberRow key={id} tabId={id} windowId={windowId} />
            ))}
            <Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />
          </View>
        </Panel>
      </OutsidePressArea>
    </Animated.View>
  );
}

function MemberRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useHover();
  const { wrapper, handle } = useDragItem(`fm:${tabId}`, { kind: "row", tabIds: [tabId], section: "folder" });
  if (!tab) return null;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View {...hoverProps}>
        <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
          <Pressable
            onPress={() => {
              closeFolderPanel();
              clickTab(windowId, tabId);
            }}
          >
            {({ pressed }) => (
              <View
                style={{
                  height: layout.rowHeight,
                  borderRadius: radius.l,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 9,
                  backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : hovered ? theme.tabHover : undefined,
                }}
              >
                <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
                <FadeLabel text={tabTitle(tab)} fontSize={font.body.fontSize} color={active ? theme.textPrimary : theme.textTab} style={{ flex: 1, height: 18, marginLeft: 8 }} />
              </View>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}
