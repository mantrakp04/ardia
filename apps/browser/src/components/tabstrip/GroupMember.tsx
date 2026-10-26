import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useGroup, useWindowId } from "../../state/browser/hooks";
import { hasOwnGroupIcon, SYMBOL_PREFIX } from "../../state/groups/groupIcons";
import { useGroupLabel } from "../../state/groups/hooks";
import { openGroupMenu } from "../../state/sidebar/menus";
import { openFolderMenu } from "../../state/tabs/topStrip";
import { setMeasuredWidth, useMeasuredWidth } from "../../state/windows/measuredWidths";
import { groupColorMenu } from "../sidebar/groupColorMenu";
import { groupTint, NEUTRAL_GROUP_SWATCH, useSidebarTokens, withAlpha } from "../sidebar/tokens";
import { ContextMenuArea, Symbol, useHover } from "../ui";
import { curve } from "../ui/motion";
import { useTheme } from "../ui/theme";
import { font, weight } from "../ui/tokens";
import { folderKey, type GroupOut, type Member } from "./model";
import { SplitChip } from "./SplitChip";
import { MEMBERS_INSET, TUCK_FADE_MS, type DragGeometry } from "./stripGroups";
import { DraggableChip, TabChip } from "./TabChip";
import { CHIP_HAIRLINE, FOLDER_HEIGHT, FOLDER_PAD, FOLDER_RADIUS, FOLDER_TITLE_GAP, FOLDER_TITLE_MAX, MID, TOP_STRIP_HEIGHT } from "./tokens";

export function GroupMember({
  member,
  width,
  start,
  offset,
  open,
  interactive,
  shown,
  geometry,
  from,
  chip,
  activeId,
  measured,
  tuck,
  out,
}: {
  member: Member;
  width: number;
  start: number;
  offset: number;
  open: Animated.Value;
  interactive: boolean;
  shown: boolean;
  geometry: DragGeometry;
  from: number;
  chip: number;
  activeId: string;
  measured: boolean;
  tuck?: () => void;
  out: GroupOut;
}) {
  const shownValue = useRef(new Animated.Value(shown ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shownValue, { toValue: shown ? 1 : 0, duration: TUCK_FADE_MS, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [shown]);
  const left = useMemo(() => open.interpolate({ inputRange: [0, 1], outputRange: [start, start + offset] }), [start, offset]);
  const opacity = useMemo(
    () =>
      Animated.add(shownValue, open.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: "clamp" })).interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: "clamp",
      }),
    [],
  );
  return (
    <Animated.View pointerEvents={interactive ? "box-none" : "none"} style={{ position: "absolute", top: 0, left, width, height: TOP_STRIP_HEIGHT, opacity: measured ? opacity : 0, zIndex: shown ? 2 : 1 }}>
      {member.kind === "folder" ? (
        <FolderMember groupId={member.id} chip={chip} shownTab={member.tabIds.includes(activeId) ? activeId : null} tuck={tuck} />
      ) : member.kind === "split" ? (
        <SplitChip tabIds={member.tabIds} width={width} geometry={geometry} from={from} group={member.group} />
      ) : (
        <DraggableChip tabId={member.id} width={width} geometry={geometry} from={from} group={member.group} tuck={tuck} out={out} />
      )}
    </Animated.View>
  );
}

function FolderMember({ groupId, chip, shownTab, tuck }: { groupId: string; chip: number; shownTab: string | null; tuck?: () => void }) {
  const width = useMeasuredWidth(folderKey(groupId)) ?? 0;
  return (
    <View pointerEvents="box-none" style={{ height: TOP_STRIP_HEIGHT }}>
      <FolderChip groupId={groupId} holding={!!shownTab} />
      {shownTab && (
        <View style={{ position: "absolute", top: 0, left: width + MEMBERS_INSET }}>
          <TabChip tabId={shownTab} width={chip} tuck={tuck} dragged={false} />
        </View>
      )}
    </View>
  );
}

function FolderChip({ groupId, holding }: { groupId: string; holding: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const windowId = useWindowId();
  const group = useGroup(groupId, (g) => g);
  const label = useGroupLabel(groupId);
  const { hovered, hoverProps } = useHover();
  if (!group) return null;
  const tint = groupTint(group.color);
  const bare = group.color === "none";
  const ink = tint ?? (holding ? theme.tabSelectedText : theme.textTab);
  return (
    <View
      {...hoverProps}
      mouseDownCanMoveWindow={false}
      tooltip={`${label}\nShow Folder`}
      onLayout={(e) => setMeasuredWidth(folderKey(groupId), Math.ceil(e.nativeEvent.layout.width * 2) / 2)}
      style={{ position: "absolute", left: 0, top: MID - FOLDER_HEIGHT / 2, height: FOLDER_HEIGHT }}
    >
      <ContextMenuArea onContextMenu={() => void openGroupMenu(windowId, groupId, groupColorMenu)}>
        <Pressable onPress={() => void openFolderMenu(windowId, groupId)}>
          {({ pressed }) => (
            <View
              style={{
                height: FOLDER_HEIGHT,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: FOLDER_PAD.left,
                paddingRight: FOLDER_PAD.right,
                borderRadius: FOLDER_RADIUS,
                borderWidth: CHIP_HAIRLINE,
                borderColor: bare ? "transparent" : theme.pinnedRestingStroke,
                backgroundColor: pressed ? theme.tabPressed : tint ? withAlpha(tint, hovered ? 0.3 : 0.22) : hovered ? tokens.groupHeaderHover : bare ? "transparent" : tokens.groupFill,
              }}
            >
              <StripGroupIcon icon={group.icon} tint={tint} />
              <Text numberOfLines={1} style={{ marginLeft: FOLDER_TITLE_GAP, maxWidth: FOLDER_TITLE_MAX, fontSize: font.small.fontSize, fontWeight: weight.semibold, color: ink }}>
                {label}
              </Text>
              <Symbol name="chevron.down" size={8} weight="semibold" color={withAlpha(ink, 0.6)} style={{ marginLeft: 5, width: 9, height: 9 }} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

export function StripGroupIcon({ icon, tint }: { icon: string | null; tint: string | null | undefined }) {
  const theme = useTheme();
  if (!hasOwnGroupIcon(icon)) return <GroupGlyph color={tint ?? (theme.dark ? NEUTRAL_GROUP_SWATCH.dark : NEUTRAL_GROUP_SWATCH.light)} />;
  if (icon.startsWith(SYMBOL_PREFIX)) return <Symbol name={icon.slice(SYMBOL_PREFIX.length)} size={11} weight="medium" color={tint ?? theme.icon} style={{ width: 13, height: 13 }} />;
  return <Text style={{ width: 13, fontSize: font.small.fontSize, textAlign: "center" }}>{icon}</Text>;
}

function GroupGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 13, height: 11, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 1.25, height: 7, borderRadius: 0.625, backgroundColor: color, opacity: 0.5 }} />
      <View style={{ width: 1.25, height: 9, borderRadius: 0.625, marginLeft: 0.6, backgroundColor: color, opacity: 0.75 }} />
      <View style={{ width: 9.4, height: 10.6, borderRadius: 2.5, marginLeft: 0.5, backgroundColor: color }} />
    </View>
  );
}
