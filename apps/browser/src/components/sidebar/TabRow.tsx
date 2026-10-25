import { ActivitySpinner, ContextMenuArea, FadeLabel, MouseArea, Surface, Symbol } from "@ardia/shell";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View, type GestureResponderEvent } from "react-native";
import { toggleMute } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, usePageProfileId, useTab, useWindowId } from "../../store/hooks";
import { HoverSlot } from "../HoverSlot";
import { IconButton, useHover } from "../primitives";
import { isPinnedRow } from "../../store/model";
import { awayFromPin } from "../../store/organize";
import { splitRowPanes } from "../../store/splits";
import { clickTab, commitRename, endRename, startRename, tabTitle } from "./actions";
import { useDragItem, useDropOnto } from "./dnd";
import { useShift, type EntryMotion } from "./entryMotion";
import { dismissHover, useRowHover } from "./hover";
import { middleClickTab, openTabMenu } from "./menus";
import { ACTIVE, LOADING, PLAYING, SELECTED, useRowState } from "./rowState";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { useSidebarTokens } from "./tokens";

export const clickMods = (e: GestureResponderEvent) => {
  const n = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
  return { metaKey: !!n.metaKey, shiftKey: !!n.shiftKey, altKey: !!n.altKey };
};

const useSelection = (windowId: string) => () => useBrowser.getState().selection[windowId] ?? [];

export const TabRowItem = memo(function TabRowItem({
  tabId,
  section,
  parentGroup,
  motion = null,
}: {
  tabId: string;
  section: "list" | "pinnedRows" | "pinnedGroups";
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const selection = useSelection(windowId);
  const { wrapper, handle } = useDragItem(`t:${tabId}`, { kind: "row", tabIds: [tabId], section, parentGroup }, selection, motion?.clip);
  const onto = useDropOnto(`t:${tabId}`);
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <TabRow tabId={tabId} onto={onto} shift={motion?.shift ?? null} />
    </Animated.View>
  );
});

export const TabRow = memo(function TabRow({ tabId, onto = false, shift = null }: { tabId: string; onto?: boolean; shift?: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const { tab, flags } = useRowState(tabId, windowId);
  const active = !!(flags & ACTIVE);
  const selected = !!(flags & SELECTED);
  const playingAudio = !!(flags & PLAYING);
  const loading = !!(flags & LOADING);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId });
  const [moved, movedRef] = useShift(shift, useCallback((v: View | null) => registerRow(windowId, tabId, v), [windowId, tabId]));
  const backToPin = useHover();
  if (!tab) return null;
  const resettable = isPinnedRow(tab) && awayFromPin(tab);
  const resetting = resettable && backToPin.hovered && !renaming;
  const title = resetting ? "Back to Pinned URL" : tabTitle(tab);
  const fill = active ? theme.tabSelected : selected ? tokens.multiSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)";
  const border = active || selected ? 0.5 : 0;

  return (
    <View
      {...moved}
      ref={movedRef}
      {...hoverProps}
      style={moved.style as object}
      onDoubleClick={() => void startRename(windowId, { kind: "tab", id: tabId })}
    >
      <MouseArea onMiddleClick={() => middleClickTab(tabId)}>
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
            {({ pressed }) => (
              <Surface
                fill={hex(onto || (!active && pressed) ? theme.tabPressed : fill)}
                cornerRadius={10}
                borderWidth={border}
                borderColor={selected && !active ? hex(tokens.multiSelectedStroke) : undefined}
                borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
                shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
                shadowOpacity={active ? 1 : 0}
                shadowRadius={theme.tabSelectedShadowRadius}
                shadowOffset={[0, 0.5]}
                style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 - border, paddingRight: 6 - border }}
              >
                {resettable ? (
                  <View {...backToPin.hoverProps}>
                    <Pressable onPress={() => useBrowser.getState().returnToPinnedUrl(tab.id)} tooltip="Back to Pinned URL (⌘↩)">
                      {resetting ? (
                        <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                          <Symbol name="arrow.uturn.backward" size={11} weight="semibold" color={active ? theme.tabSelectedText : theme.textTab} style={{ width: 16, height: 16 }} />
                        </View>
                      ) : (
                        <View>
                          <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} />
                          <TabBadges tabId={tab.id} />
                        </View>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} />
                    <TabBadges tabId={tab.id} />
                  </View>
                )}
                {(playingAudio || tab.muted) && (
                  <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 6 }} tooltip={tab.muted ? "Unmute Site" : "Mute Site"}>
                    <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16 }} />
                  </Pressable>
                )}
                {renaming ? (
                  <RenameField
                    initial={tab.customTitle ?? tab.title}
                    placeholder={tab.title || "Tab name"}
                    color={active ? theme.tabSelectedText : theme.textPrimary}
                    onDone={(text) => (text === null ? endRename({ kind: "tab", id: tabId }) : commitRename({ kind: "tab", id: tabId }, text))}
                  />
                ) : (
                  <FadeLabel text={title} fontSize={13} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
                )}
                <HoverSlot
                  hovered={hovered && !renaming}
                  width={22}
                  hover={<IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => middleClickTab(tab.id)} tooltip="Close Tab (⌘W)" />}
                >
                  {loading && <ActivitySpinner style={{ width: 12, height: 12, marginRight: 2 }} />}
                </HoverSlot>
              </Surface>
            )}
          </Pressable>
        </ContextMenuArea>
      </MouseArea>
    </View>
  );
});

export function RenameField({
  initial,
  placeholder,
  color,
  fontSize = 13,
  weight,
  onDone,
}: {
  initial: string;
  placeholder: string;
  color: string;
  fontSize?: number;
  weight?: "500" | "600";
  onDone(text: string | null): void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const input = useRef<TextInput>(null);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <TextInput
      ref={input}
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={theme.placeholder}
      selectionColor={theme.selection}
      selectTextOnFocus
      enableFocusRing={false}
      onSubmitEditing={() => finish(text)}
      onBlur={() => finish(text)}
      keyDownEvents={[{ key: "Escape" }]}
      onKeyDown={(e) => e.nativeEvent.key === "Escape" && finish(null)}
      style={{ flex: 1, height: 18, marginLeft: 5, fontSize, fontWeight: weight, color, paddingVertical: 0, paddingHorizontal: 0 }}
    />
  );
}

export const SplitRowItem = memo(function SplitRowItem({
  splitId,
  section,
  parentGroup,
  motion = null,
}: {
  splitId: string;
  section: "list" | "pinnedRows" | "pinnedGroups";
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const tabIds = useBrowser((s) => splitRowPanes(s, s.splits[splitId]).join(",")).split(",").filter(Boolean);
  const { wrapper, handle } = useDragItem(`s:${splitId}`, { kind: "split", tabIds, section, parentGroup }, undefined, motion?.clip);
  const theme = useTheme();
  const profileId = usePageProfileId();
  const active = useBrowser((s) => tabIds.includes(s.windows[windowId]?.activeTabIds[profileId] ?? ""));
  const { hovered, hoverProps } = useRowHover(windowId, null);
  const [moved, movedRef] = useShift(motion?.shift ?? null, useCallback((v: View | null) => registerRow(windowId, `s:${splitId}`, v), [windowId, splitId]));
  if (tabIds.length < 2) return null;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View {...moved} ref={movedRef} {...hoverProps} style={moved.style as object}>
        <Surface
          fill={hex(active ? theme.tabSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)")}
          cornerRadius={10}
          borderWidth={active ? 1 : 0}
          borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
          shadowColor={active ? hex(theme.tabSelectedShadow) : undefined}
          shadowOpacity={active ? 1 : 0}
          shadowRadius={theme.tabSelectedShadowRadius}
          shadowOffset={[0, 0.5]}
          style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: active ? 2 : 3 }}
        >
          {tabIds.map((id, i) => (
            <View key={id} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
              {i > 0 && <View style={{ width: 1, height: 16, backgroundColor: theme.divider, marginRight: 2 }} />}
              <SplitPane tabId={id} windowId={windowId} />
            </View>
          ))}
        </Surface>
      </View>
    </Animated.View>
  );
});

function SplitPane({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
        <Pressable onPress={(e) => clickTab(windowId, tabId, clickMods(e))}>
          <View
            style={{
              height: layout.rowHeight - 6,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 6,
              backgroundColor: hovered && !active ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} />
            <FadeLabel text={tabTitle(tab)} fontSize={12} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
