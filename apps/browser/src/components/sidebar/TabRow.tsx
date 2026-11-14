import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, TextInput, View, type GestureResponderEvent } from "react-native";
import { toggleMute } from "../../state/browser/actions";
import { useTheme } from "../ui/theme";
import { useIsActiveTab, usePageProfileId, useTab, useWindow, useWindowId } from "../../state/browser/hooks";
import { returnToPinnedUrl } from "../../state/pins/actions";
import { useSplitRowPanes } from "../../state/sidebar/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { usePictureInPicture } from "../../state/media/media";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, Button, Divider, FadeLabel, ink, OutsidePressArea, Symbol, useHover } from "../ui";
import { isPinnedRow, tabTitle } from "../../state/browser/model";
import { awayFromPin, awayTitle } from "../../state/pins/organize";
import { commitRename, endRename, startRename } from "../../state/sidebar/actions";
import { useDragItem, useDropOnto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { useRowHover } from "./hoverController";
import { pressPaneClose, pressTabClose, useTabCloseControlWhile } from "../../state/sidebar/closeControl";
import { modifiersOf } from "../../lib/keys";
import { ACTIVE, ICON_MARKS, LOADING, mutedBy, PLAYING, SELECTED, useRowState } from "../../state/sidebar/rowState";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { UnreadCount } from "../unread/UnreadBadge";
import { useTabUnread } from "../../state/tabs/unread";
import { titleWithoutUnread } from "../../lib/unread";
import { useSidebarTokens } from "./tokens";
import { useSidebarScale } from "./scale";
import { useSidebarRowLook } from "./rowLook";
import { SidebarRowLabel, SidebarRowSurface } from "./SidebarRow";
import { AwayTitleLabel } from "./AwayTitle";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabPressArea } from "./TabPressArea";
import { entryKey } from "../../state/sidebar/entryKey";
import type { RowSection } from "./dragModel";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";

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

export const TabRow = memo(function TabRow({
  tabId,
  onto = false,
  shift = null,
}: {
  tabId: string;
  onto?: boolean;
  shift?: Animated.Value | null;
}) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const m = useSidebarScale();
  const windowId = useWindowId();
  const { tab, flags } = useRowState(tabId, windowId);
  const active = !!(flags & ACTIVE);
  const selected = !!(flags & SELECTED);
  const playingAudio = !!(flags & PLAYING);
  const mute = mutedBy(flags);
  const loading = !!(flags & LOADING);
  const [pip, togglePip] = usePictureInPicture(tabId);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId });
  const [moved, movedRef] = useShift(shift, useCallback((v: View | null) => registerRow(windowId, tabId, v), [windowId, tabId]));
  const backToPin = useHover();
  const closeControl = useTabCloseControlWhile(tabId, hovered && !renaming);
  const { backToPinHint } = useSidebarRowLook();
  const unread = useTabUnread(tabId);
  const [unreadDrawn, setUnreadDrawn] = useState(false);
  const showsUnread = !!unread || unreadDrawn;
  const resettable = !!tab && (isPinnedRow(tab) || !tab.pin) && awayFromPin(tab);
  const pinActionMotion = usePressScaleMotion(resettable, buttonMotion.iconPressScale);
  const pinActionScale = pinActionMotion.scale ? { transform: [{ scale: pinActionMotion.scale }] } : undefined;
  if (!tab) return null;
  const resetting = resettable && backToPin.hovered && !renaming;
  const title = resetting ? "Back to Pinned URL" : tab.customTitle ? tabTitle(tab) : titleWithoutUnread(tabTitle(tab), unread);
  const away = resettable && !resetting ? awayTitle(tab) : null;
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
            padLeft={m.tabRow.contentLeft - border}
            padRight={m.tabRow.trailing - border}
          >
            <View {...backToPin.hoverProps}>
              {resettable ? (
                <Pressable
                  onPress={() => returnToPinnedUrl(tab.id)}
                  onPressIn={pinActionMotion.onPressIn}
                  onPressOut={pinActionMotion.onPressOut}
                  tooltip={withShortcut("Back to Pinned URL", backToPinHint)}
                >
                  <Animated.View pointerEvents="none" style={pinActionScale}>
                    {resetting ? (
                      <View style={{ width: m.icon, height: m.icon, alignItems: "center", justifyContent: "center" }}>
                        <Symbol name="arrow.uturn.backward" size={m.glyph.s} weight="semibold" color={active ? theme.rowSelectedText : theme.textTab} style={{ width: m.icon, height: m.icon }} />
                      </View>
                    ) : (
                      <View>
                        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} marks={flags & ICON_MARKS} size={m.icon} />
                        <TabBadges tabId={tab.id} size={m.icon} />
                      </View>
                    )}
                  </Animated.View>
                </Pressable>
              ) : (
                <>
                  <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} marks={flags & ICON_MARKS} size={m.icon} />
                  <TabBadges tabId={tab.id} size={m.icon} />
                </>
              )}
            </View>
            {pip && (
              <StatusIconButton icon="pip" color={theme.textTab} tooltip="Exit Picture in Picture" onPress={togglePip} />
            )}
            {(playingAudio || mute) && (
              <StatusIconButton icon={mute ? "speaker.slash" : "speaker.wave.2"} color={theme.textTab} tooltip={muteTitle(mute)} onPress={() => toggleMute(tab.id)} />
            )}
            {renaming ? (
              <RenameField
                initial={tab.customTitle ?? tab.title}
                placeholder={tab.title || "Tab name"}
                color={active ? theme.rowSelectedText : theme.textPrimary}
                onDone={(text) => (text === null ? endRename({ kind: "tab", id: tabId }) : commitRename({ kind: "tab", id: tabId }, text))}
              />
            ) : away ? (
              <AwayTitleLabel away={away} color={active ? theme.rowSelectedText : theme.textTab} fontSize={m.font.body} height={m.tabRow.titleHeight} style={m.titleFrame} />
            ) : (
              <SidebarRowLabel text={title} color={active ? theme.rowSelectedText : theme.textTab} />
            )}
            <HoverSlot
              hovered={hovered && !renaming}
              reserve="hover"
              width={m.rowButton.box}
              hover={closeControl && <Button variant="icon" icon={closeControl.icon} box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={() => pressTabClose(tab.id)} tooltip={closeControl.tooltip} />}
            >
              {loading || showsUnread ? (
                <>
                  {loading && <ActivitySpinner style={{ width: m.glyph.m, height: m.glyph.m, marginRight: m.space.xxs }} />}
                  {showsUnread && <UnreadCount unread={unread} ink={active ? theme.rowSelectedText : theme.textTab} onDrawn={setUnreadDrawn} />}
                </>
              ) : null}
            </HoverSlot>
          </SidebarRowSurface>
      )}
      </TabPressArea>
    </View>
  );
});


function StatusIconButton({ icon, color, tooltip, onPress }: { icon: string; color: string; tooltip: string; onPress: (event: GestureResponderEvent) => void }) {
  const m = useSidebarScale();
  const pressMotion = usePressScaleMotion(true, buttonMotion.iconPressScale);
  const scaleStyle = pressMotion.scale ? { transform: [{ scale: pressMotion.scale }] } : undefined;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressMotion.onPressIn}
      onPressOut={pressMotion.onPressOut}
      style={{ marginLeft: m.space.s }}
      tooltip={tooltip}
    >
      <Animated.View style={[{ ...STATUS_GLYPH, width: m.px(18), height: m.icon }, scaleStyle]}>
        <Symbol name={icon} size={m.glyph.m} color={color} style={{ ...STATUS_GLYPH, width: m.px(18), height: m.icon }} />
      </Animated.View>
    </Pressable>
  );
}

const STATUS_GLYPH = { width: 18, height: 16, alignItems: "center", justifyContent: "center" } as const;

export function RenameField({
  initial,
  placeholder,
  color,
  fontSize,
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
  const m = useSidebarScale();
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
    <OutsidePressArea onOutsidePress={() => finish(text)} style={m.titleFrame}>
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
        style={{ flex: 1, fontSize: fontSize ?? m.font.body, fontWeight: weight, color, paddingVertical: 0, paddingHorizontal: 0, transform: [{ translateY: m.tabRow.renameTextOffset }] }}
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
  const m = useSidebarScale();
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
          padLeft={m.space.xs - splitBorder}
          padRight={m.space.xs - splitBorder}
        >
          {tabIds.map((id, i) => (
            <View key={id} style={[SPLIT_SLOT, { gap: m.space.xxs }]}>
              {i > 0 && <Divider vertical thick length={m.px(SPLIT_DIVIDER_LENGTH)} />}
              <SplitPane tabId={id} windowId={windowId} />
            </View>
          ))}
        </SidebarRowSurface>
      </View>
    </Animated.View>
  );
});

const SPLIT_DIVIDER_LENGTH = 16;
const SPLIT_SLOT = { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 } as const;

function SplitPane({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const m = useSidebarScale();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  const closeControl = useTabCloseControlWhile(tabId, hovered);
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <TabPressArea windowId={windowId} tab={tab}>
        {({ pressed }) => (
          <View
            style={{
              height: m.rowHeight - m.px(6),
              borderRadius: m.radius.tile,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: m.space.s,
              backgroundColor: active ? undefined : pressed ? theme.tabPressed : hovered ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={m.compactIcon} />
            <FadeLabel text={tabTitle(tab)} fontSize={m.font.small} color={active ? theme.rowSelectedText : theme.textTab} style={{ flex: 1, height: m.icon, marginLeft: m.space.xs }} />
            <HoverSlot
              hovered={hovered}
              reserve="hover"
              width={m.rowButton.box}
              hover={closeControl && <Button variant="icon" icon={closeControl.icon} box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={(e: GestureResponderEvent) => pressPaneClose(tab.id, modifiersOf(e).altKey)} tooltip={closeControl.tooltip} />}
            />
          </View>
        )}
      </TabPressArea>
    </View>
  );
}
