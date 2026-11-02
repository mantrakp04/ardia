import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View } from "react-native";
import { toggleMute } from "../../state/browser/actions";
import { layout, useTheme } from "../ui/theme";
import { useIsActiveTab, usePageProfileId, useTab, useWindow, useWindowId } from "../../state/browser/hooks";
import { returnToPinnedUrl } from "../../state/pins/actions";
import { useSplitRowPanes } from "../../state/sidebar/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, Button, Divider, FadeLabel, font, ink, OutsidePressArea, radius, space, Symbol, useHover } from "../ui";
import { isPinnedRow, tabTitle } from "../../state/browser/model";
import { awayFromPin } from "../../state/pins/organize";
import { commitRename, endRename, startRename } from "../../state/sidebar/actions";
import { useDragItem, useDropOnto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { useRowHover } from "./hoverController";
import { pressTabClose, useTabCloseControlWhile } from "../../state/sidebar/closeControl";
import { ACTIVE, ICON_MARKS, LOADING, mutedBy, PLAYING, SELECTED, useRowState } from "../../state/sidebar/rowState";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { TAB_ROW, useSidebarTokens } from "./tokens";
import { useSidebarRowLook } from "./rowLook";
import { ROW_TITLE_FRAME, SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabPressArea } from "./TabPressArea";
import { entryKey } from "../../state/sidebar/entryKey";
import type { RowSection } from "./dragModel";

export const TabRowItem = memo(function TabRowItem({
  tabId,
  section,
  parentGroup,
  motion = null,
}: {
  tabId: string;
  section: RowSection;
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const { wrapper, handle } = useDragItem(entryKey("tab", tabId), { kind: "row", tabIds: [tabId], section, parentGroup }, motion?.clip);
  const onto = useDropOnto(entryKey("tab", tabId));
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
  const mute = mutedBy(flags);
  const loading = !!(flags & LOADING);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId });
  const [moved, movedRef] = useShift(shift, useCallback((v: View | null) => registerRow(windowId, tabId, v), [windowId, tabId]));
  const backToPin = useHover();
  const closeControl = useTabCloseControlWhile(tabId, hovered && !renaming);
  const { backToPinHint } = useSidebarRowLook();
  if (!tab) return null;
  const resettable = (isPinnedRow(tab) || !tab.pin) && awayFromPin(tab);
  const resetting = resettable && backToPin.hovered && !renaming;
  const title = resetting ? "Back to Pinned URL" : tabTitle(tab);
  const fill = active ? theme.tabSelected : selected ? tokens.multiSelected : hovered ? theme.tabHover : ink.clear;
  const border = active || selected ? 0.5 : 0;

  return (
    <View
      {...moved}
      ref={movedRef}
      {...hoverProps}
      style={moved.style as object}
      onDoubleClick={() => void startRename(windowId, { kind: "tab", id: tabId })}
    >
      <TabPressArea windowId={windowId} tab={tab}>
      {({ pressed }) => (
          <SidebarRowSurface
            fill={onto || (!active && pressed) ? theme.tabPressed : fill}
            selected={active}
            border={border}
            stroke={selected && !active ? tokens.multiSelectedStroke : undefined}
            padLeft={TAB_ROW.contentLeft - border}
            padRight={TAB_ROW.trailing - border}
          >
            {resettable ? (
              <View {...backToPin.hoverProps}>
                <Pressable onPress={() => returnToPinnedUrl(tab.id)} tooltip={withShortcut("Back to Pinned URL", backToPinHint)}>
                  {resetting ? (
                    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                      <Symbol name="arrow.uturn.backward" size={11} weight="semibold" color={active ? theme.tabSelectedText : theme.textTab} style={{ width: 16, height: 16 }} />
                    </View>
                  ) : (
                    <View>
                      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} marks={flags & ICON_MARKS} />
                      <TabBadges tabId={tab.id} />
                    </View>
                  )}
                </Pressable>
              </View>
            ) : (
              <View>
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} marks={flags & ICON_MARKS} />
                <TabBadges tabId={tab.id} />
              </View>
            )}
            {(playingAudio || mute) && (
              <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: space.s }} tooltip={muteTitle(mute)}>
                <Symbol name={mute ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16 }} />
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
              <SidebarRowLabel text={title} color={active ? theme.tabSelectedText : theme.textTab} />
            )}
            <HoverSlot
              hovered={hovered && !renaming}
              reserve="hover"
              hover={closeControl && <Button variant="icon" icon={closeControl.icon} size="s" weight="semibold" onPress={() => pressTabClose(tab.id)} tooltip={closeControl.tooltip} />}
            >
              {loading && <ActivitySpinner style={{ width: 12, height: 12, marginRight: space.xxs }} />}
            </HoverSlot>
          </SidebarRowSurface>
      )}
      </TabPressArea>
    </View>
  );
});

export function RenameField({
  initial,
  placeholder,
  color,
  fontSize = font.body.fontSize,
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
    <OutsidePressArea onOutsidePress={() => finish(text)} style={ROW_TITLE_FRAME}>
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
        style={{ flex: 1, fontSize, fontWeight: weight, color, paddingVertical: 0, paddingHorizontal: 0 }}
      />
    </OutsidePressArea>
  );
}

export const SplitRowItem = memo(function SplitRowItem({
  splitId,
  section,
  parentGroup,
  motion = null,
}: {
  splitId: string;
  section: RowSection;
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const tabIds = useSplitRowPanes(splitId);
  const { wrapper, handle } = useDragItem(entryKey("split", splitId), { kind: "split", tabIds, section, parentGroup }, motion?.clip);
  const theme = useTheme();
  const profileId = usePageProfileId();
  const active = useWindow(windowId, (w) => tabIds.includes(w?.activeTabIds[profileId] ?? ""));
  const { hovered, hoverProps } = useRowHover(windowId, null);
  const [moved, movedRef] = useShift(motion?.shift ?? null, useCallback((v: View | null) => registerRow(windowId, entryKey("split", splitId), v), [windowId, splitId]));
  if (tabIds.length < 2) return null;
  const splitBorder = active ? 1 : 0;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View {...moved} ref={movedRef} {...hoverProps} style={moved.style as object}>
        <SidebarRowSurface
          fill={active ? theme.tabSelected : hovered ? theme.tabHover : ink.clear}
          selected={active}
          border={splitBorder}
          padLeft={space.xs - splitBorder}
          padRight={space.xs - splitBorder}
        >
          {tabIds.map((id, i) => (
            <View key={id} style={SPLIT_SLOT}>
              {i > 0 && <Divider vertical thick length={SPLIT_DIVIDER_LENGTH} />}
              <SplitPane tabId={id} windowId={windowId} />
            </View>
          ))}
        </SidebarRowSurface>
      </View>
    </Animated.View>
  );
});

const SPLIT_DIVIDER_LENGTH = 16;
const SPLIT_SLOT = { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0, gap: space.xxs } as const;

function SplitPane({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <TabPressArea windowId={windowId} tab={tab}>
        {({ pressed }) => (
          <View
            style={{
              height: layout.rowHeight - 6,
              borderRadius: radius.tile,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: space.s,
              backgroundColor: active ? undefined : pressed ? theme.tabPressed : hovered ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} compact />
            <FadeLabel text={tabTitle(tab)} fontSize={font.small.fontSize} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: space.xs }} />
          </View>
        )}
      </TabPressArea>
    </View>
  );
}
