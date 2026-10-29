import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View } from "react-native";
import { toggleMute } from "../../state/browser/actions";
import { hex, layout, useTheme } from "../ui/theme";
import { useIsActiveTab, usePageProfileId, useTab, useWindow, useWindowId } from "../../state/browser/hooks";
import { returnToPinnedUrl } from "../../state/pins/actions";
import { useSplitRowPanes } from "../../state/sidebar/hooks";
import { useMuteState } from "../../state/tabs/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, Button, FadeLabel, font, ink, OutsidePressArea, radius, Surface, Symbol, useHover } from "../ui";
import { isPinnedRow, tabTitle } from "../../state/browser/model";
import { awayFromPin } from "../../state/pins/organize";
import { commitRename, endRename, startRename } from "../../state/sidebar/actions";
import { useDragItem, useDropOnto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { useRowHover } from "./hoverController";
import { pressTabClose, useTabCloseControlWhile } from "../../state/sidebar/closeControl";
import { ACTIVE, ICON_MARKS, LOADING, PLAYING, SELECTED, useRowState } from "../../state/sidebar/rowState";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { SELECTED_ROW_SHADOW_OFFSET, useSidebarTokens } from "./tokens";
import { useSelectedTabGlow, useSidebarRowLook } from "./rowLook";
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
  const glow = useSelectedTabGlow();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const { tab, flags } = useRowState(tabId, windowId);
  const active = !!(flags & ACTIVE);
  const selected = !!(flags & SELECTED);
  const playingAudio = !!(flags & PLAYING);
  const mute = useMuteState(tabId);
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
          <Surface
            fill={hex(onto || (!active && pressed) ? theme.tabPressed : fill)}
            cornerRadius={radius.card}
            borderWidth={border}
            borderColor={selected && !active ? hex(tokens.multiSelectedStroke) : undefined}
            borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
            shadowColor={active ? glow.shadowColor : undefined}
            shadowOpacity={active ? glow.shadowOpacity : 0}
            shadowRadius={glow.shadowRadius}
            shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
            style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9 - border, paddingRight: 6 - border }}
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
              <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 6 }} tooltip={muteTitle(mute)}>
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
              <FadeLabel text={title} fontSize={font.body.fontSize} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 18, marginLeft: 5 }} />
            )}
            <HoverSlot
              hovered={hovered && !renaming}
              width={22}
              reserve="hover"
              hover={closeControl && <Button variant="icon" icon={closeControl.icon} size={10} weight="semibold" box={22} radius={radius.m} onPress={() => pressTabClose(tab.id)} tooltip={closeControl.tooltip} />}
            >
              {loading && <ActivitySpinner style={{ width: 12, height: 12, marginRight: 2 }} />}
            </HoverSlot>
          </Surface>
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
    <OutsidePressArea onOutsidePress={() => finish(text)} style={{ flex: 1, height: 18, marginLeft: 5 }}>
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
  const glow = useSelectedTabGlow();
  const profileId = usePageProfileId();
  const active = useWindow(windowId, (w) => tabIds.includes(w?.activeTabIds[profileId] ?? ""));
  const { hovered, hoverProps } = useRowHover(windowId, null);
  const [moved, movedRef] = useShift(motion?.shift ?? null, useCallback((v: View | null) => registerRow(windowId, entryKey("split", splitId), v), [windowId, splitId]));
  if (tabIds.length < 2) return null;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View {...moved} ref={movedRef} {...hoverProps} style={moved.style as object}>
        <Surface
          fill={hex(active ? theme.tabSelected : hovered ? theme.tabHover : ink.clear)}
          cornerRadius={radius.card}
          borderWidth={active ? 1 : 0}
          borderColors={active ? theme.tabSelectedBorder.map(hex) : undefined}
          shadowColor={active ? glow.shadowColor : undefined}
          shadowOpacity={active ? glow.shadowOpacity : 0}
          shadowRadius={glow.shadowRadius}
          shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
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
      <TabPressArea windowId={windowId} tab={tab}>
        {({ pressed }) => (
          <View
            style={{
              height: layout.rowHeight - 6,
              borderRadius: radius.button,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 6,
              backgroundColor: active ? undefined : pressed ? theme.tabPressed : hovered ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} />
            <FadeLabel text={tabTitle(tab)} fontSize={font.small.fontSize} color={active ? theme.tabSelectedText : theme.textTab} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        )}
      </TabPressArea>
    </View>
  );
}
