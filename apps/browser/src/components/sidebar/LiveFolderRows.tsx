import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { showAllIn, toggleStack, useLive } from "../../state/live/store";
import type { FolderRow } from "../../state/live/rows";
import { ContextMenuArea, font, radius, Symbol, useHover, weight } from "../ui";
import { curve, duration } from "../ui/motion";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { Fold, useFold } from "./Fold";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveStackMenu } from "../../state/sidebar/liveMenus";
import { LiveItemRow } from "./LiveItemRow";
import { SIDEBAR_TYPE, TABULAR_NUMS, useSidebarTokens } from "./tokens";

export function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View style={{ height: 22, justifyContent: "flex-end", paddingLeft: 9, paddingBottom: 2 }}>
      <Text numberOfLines={1} style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textSecondary }}>
        {title}
      </Text>
    </View>
  );
}

export function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6, gap: 6, borderRadius: radius.l, backgroundColor: onPress && hovered ? theme.rowHover : undefined }}>
      {spinner ? <Spinner /> : icon ? <Symbol name={icon} size={10} color={colors.pending} style={{ width: 16, height: 16 }} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, ...font.small, color: theme.textSecondary }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View {...hoverProps}>
      {onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}
    </View>
  );
}

function Spinner() {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: duration.spinnerTurn, easing: curve.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
      <Symbol name="arrow.triangle.2.circlepath" size={10} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
    </Animated.View>
  );
}

export function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={() => showAllIn(folderId, section)}>
        <View style={{ height: 26, borderRadius: radius.l, flexDirection: "row", alignItems: "center", paddingLeft: 9, backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Symbol name="ellipsis" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          <Text style={{ marginLeft: 5, ...font.small, color: theme.textSecondary }}>Show {count} More</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function StackRow({ folderId, windowId, stack }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }> }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const collapsed = useLive((s) => s.expandedStacks[stack.id] === false);
  const fold = useFold(collapsed);
  const { hovered, hoverProps } = useHover();
  const repo = stack.repo.split("/")[1] ?? stack.repo;
  return (
    <View>
      <View {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveStackMenu(folderId, stack.id);
          }}
        >
          <Pressable
            onPress={() => toggleStack(stack.id)}
            accessibilityLabel={collapsed ? "Expand pull request stack" : "Collapse pull request stack"}
          >
            <View style={{ height: 26, borderRadius: radius.l, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: hovered ? theme.rowHover : undefined }}>
              <Symbol name="square.stack.3d.up" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
              <Text numberOfLines={1} style={{ flex: 1, marginLeft: 5, ...font.small, fontWeight: weight.medium, color: theme.textSecondary }}>
                {repo} stack
              </Text>
              <View style={{ minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 5, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                <Text style={{ fontSize: SIDEBAR_TYPE.count, fontWeight: weight.semibold, color: theme.textTab, fontVariant: TABULAR_NUMS }}>{stack.items.length}</Text>
              </View>
              <Symbol name={collapsed ? "chevron.right" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 12 }} />
            </View>
          </Pressable>
        </ContextMenuArea>
      </View>
      <Fold
        fold={fold}
        collapsed={collapsed}
        entries={stack.items.map((item) => ({ key: item.id, node: <LiveItemRow folderId={folderId} item={item} windowId={windowId} inStack /> }))}
        gap={layout.rowGap}
        rowHeight={layout.rowHeight}
        padTop={layout.rowGap}
      />
    </View>
  );
}
