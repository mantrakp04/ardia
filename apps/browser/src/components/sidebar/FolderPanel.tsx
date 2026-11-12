import { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { layout, useTheme } from "../ui/theme";
import { useIsActiveTab, useTab } from "../../state/browser/hooks";
import { plural, tabTitle } from "../../state/browser/model";
import { useTileFolderLabel, useTileFolderMembers } from "../../state/pins/hooks";
import { SLIDE } from "../tabstrip/tokens";
import { ContextMenuArea, HoverCard as HoverPanel, OutsidePressArea, space, useHover } from "../ui";
import { SectionLabel } from "./SectionLabel";
import { SidebarListRow, SidebarRowLabel } from "./SidebarRow";
import { useSidebarScale } from "./scale";
import { clickTab } from "../../state/sidebar/actions";
import { useDragController, useDragItem, useFolderAway } from "./DragProvider";
import { openTabMenu } from "../../state/sidebar/menus";
import { TabIcon } from "./TabIcon";
import { closeFolderPanel, closeFolderPanelOnPress, closeFolderPanelWhenWindowMoves, openTileFolderMenu, useFolderPanel } from "../../state/sidebar/tileFolderUi";
import { tailKey } from "./dragModel";

const PANEL_GAP = space.s;

type Frame = { x: number; y: number; w: number; h: number };

export function FolderPanel({ windowId }: { windowId: string }) {
  const open = useFolderPanel((u) => (u.open?.windowId === windowId ? u.open : null));
  if (!open) return null;
  return <PanelBody key={open.folderId} windowId={windowId} folderId={open.folderId} anchor={open.anchor} />;
}

function PanelBody({ windowId, folderId, anchor }: { windowId: string; folderId: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const controller = useDragController();
  const m = useSidebarScale();
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
        <HoverPanel width={root.w - layout.sidebarInset * 2} pad="s">
          <ContextMenuArea onContextMenu={() => void openTileFolderMenu(windowId, folderId)}>
            <SectionLabel
              title={`${label} · ${plural(members.length, "tab")}`}
              inset={m.space.s}
              top={m.space.xxs}
              bottom={m.space.s}
              fontSize={m.font.caption}
              lineHeight={m.lineHeight.caption}
            />
          </ContextMenuArea>
          <View style={{ gap: m.rowGap }}>
            {members.map((id) => (
              <MemberRow key={id} tabId={id} windowId={windowId} />
            ))}
            <Animated.View ref={tail.wrapper.ref} style={tail.wrapper.style} />
          </View>
        </HoverPanel>
      </OutsidePressArea>
    </Animated.View>
  );
}

function MemberRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const m = useSidebarScale();
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
              <SidebarListRow height={m.rowHeight} padRight={m.tabRow.contentLeft} fill={pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : hovered ? theme.tabHover : undefined}>
                <TabIcon tabId={tabId} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={m.icon} />
                <SidebarRowLabel text={tabTitle(tab)} color={active ? theme.textPrimary : theme.textTab} />
              </SidebarListRow>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}
