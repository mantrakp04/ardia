import { Animated, Pressable, View } from "react-native";
import { hideStack, showAllIn, toggleStack, useLive } from "../../state/live/store";
import type { FolderRow } from "../../state/live/rows";
import { Badge, Button, space, Symbol, Text, useHover } from "../ui";
import { HoverSlot } from "../ui/HoverSlot";
import { useTheme } from "../ui/theme";
import { lineHeight } from "../ui/tokens";
import { useLiveColors } from "../live/tokens";
import { reduceMotion } from "../ui/reduceMotion";
import { Fold, useFold } from "./Fold";
import { useStackTabOpen } from "../../state/sidebar/hooks";
import { noteLiveStackHide } from "../../state/telemetry/liveHides";
import { LiveItemRow } from "./LiveItemRow";
import { RefreshSpinner } from "./RefreshSpinner";
import { SectionLabel } from "./SectionLabel";
import { SidebarListRow } from "./SidebarRow";
import { useSidebarScale } from "./scale";

const SECTION_HEIGHT = 22;
const NOTE_HEIGHT = 28;
const LIST_ROW_HEIGHT = 26;
const ROW_SYMBOL = { small: 10, medium: 11, chevron: 9, chevronBox: 12, spinnerBox: 14 } as const;

export function SectionTitle({ title }: { title: string }) {
  const m = useSidebarScale();
  return (
    <SectionLabel
      title={title}
      inset={m.tabRow.contentLeft}
      top={m.px(SECTION_HEIGHT - space.xxs - lineHeight.caption)}
      bottom={m.space.xxs}
      fontSize={m.font.caption}
      lineHeight={m.lineHeight.caption}
    />
  );
}

export function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const m = useSidebarScale();
  const { hovered, hoverProps } = useHover();
  const body = (
    <SidebarListRow height={m.px(NOTE_HEIGHT)} padRight={m.tabRow.trailing} fill={onPress && hovered ? theme.rowHover : undefined} style={{ gap: m.space.s }}>
      {spinner ? <Spinner /> : icon ? <Symbol name={icon} size={m.px(ROW_SYMBOL.small)} color={colors.pending} style={{ width: m.icon, height: m.icon }} /> : null}
      <Text lines={2} size="small" tone="textSecondary" style={[FILL, { fontSize: m.font.small }]}>
        {text}
      </Text>
    </SidebarListRow>
  );
  return (
    <View {...hoverProps}>
      {onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}
    </View>
  );
}

const FILL = { flex: 1 } as const;

function Spinner() {
  const theme = useTheme();
  const m = useSidebarScale();
  return (
    <RefreshSpinner style={{ width: m.icon, height: m.icon, alignItems: "center", justifyContent: "center" }}>
      <Symbol name="arrow.triangle.2.circlepath" size={m.px(ROW_SYMBOL.small)} color={theme.textSecondary} style={{ width: m.px(ROW_SYMBOL.spinnerBox), height: m.px(ROW_SYMBOL.spinnerBox) }} />
    </RefreshSpinner>
  );
}

export function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const m = useSidebarScale();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={() => showAllIn(folderId, section)}>
        <SidebarListRow height={m.px(LIST_ROW_HEIGHT)} fill={hovered ? theme.rowHover : undefined}>
          <Symbol name="ellipsis" size={m.px(ROW_SYMBOL.medium)} color={theme.textSecondary} style={{ width: m.icon, height: m.icon }} />
          <Text size="small" tone="textSecondary" style={{ fontSize: m.font.small, marginLeft: m.tabRow.titleGap }}>
            Show {count} More
          </Text>
        </SidebarListRow>
      </Pressable>
    </View>
  );
}

export function StackRow({ folderId, windowId, stack }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }> }) {
  const theme = useTheme();
  const m = useSidebarScale();
  const collapsed = useLive((s) => s.expandedStacks[stack.id] === false);
  const fold = useFold(collapsed);
  const { hovered, hoverProps } = useHover();
  const tabOpen = useStackTabOpen(folderId, stack.id);
  const chevronRotation = reduceMotion() === false ? fold.open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) : collapsed ? "-90deg" : "0deg";
  const hide = () => {
    hideStack(folderId, stack.id);
    noteLiveStackHide();
  };
  const repo = stack.repo.split("/")[1] ?? stack.repo;
  return (
    <View>
      <View {...hoverProps}>
        <Pressable
          onPress={() => toggleStack(stack.id)}
          accessibilityLabel={collapsed ? "Expand pull request stack" : "Collapse pull request stack"}
        >
          <SidebarListRow height={m.px(LIST_ROW_HEIGHT)} padRight={m.space.m} fill={hovered ? theme.rowHover : undefined}>
            <Symbol name="square.stack.3d.up" size={m.px(ROW_SYMBOL.medium)} color={theme.textSecondary} style={{ width: m.icon, height: m.icon }} />
            <Text lines={1} size="small" weight="medium" tone="textSecondary" style={{ flex: 1, fontSize: m.font.small, marginLeft: m.tabRow.titleGap }}>
              {repo} stack
            </Text>
            <HoverSlot
              hovered={hovered && !tabOpen}
              hover={<Button variant="icon" icon="xmark" box={m.rowButton.box} glyph={m.rowButton.glyph} weight="semibold" onPress={hide} tooltip="Hide Stack Until Refresh" />}
              style={{ marginRight: m.space.xs }}
            >
              <Badge text={stack.items.length} size="m" scale={m.scale} />
            </HoverSlot>
            <Animated.View style={{ width: m.px(ROW_SYMBOL.chevronBox), height: m.px(ROW_SYMBOL.chevronBox), transform: [{ rotate: chevronRotation }] }}>
              <Symbol name="chevron.down" size={m.px(ROW_SYMBOL.chevron)} weight="semibold" color={theme.textSecondary} style={{ width: m.px(ROW_SYMBOL.chevronBox), height: m.px(ROW_SYMBOL.chevronBox) }} />
            </Animated.View>
          </SidebarListRow>
        </Pressable>
      </View>
      <Fold
        fold={fold}
        collapsed={collapsed}
        entries={stack.items.map((item) => ({ key: item.id, node: <LiveItemRow folderId={folderId} item={item} windowId={windowId} inStack /> }))}
        rowHeight={m.rowHeight}
        padTop={m.rowGap}
      />
    </View>
  );
}
