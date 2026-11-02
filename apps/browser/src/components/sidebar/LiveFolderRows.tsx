import { Pressable, View } from "react-native";
import { showAllIn, toggleStack, useLive } from "../../state/live/store";
import type { FolderRow } from "../../state/live/rows";
import { Badge, ContextMenuArea, space, Symbol, Text, useHover } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { lineHeight } from "../ui/tokens";
import { useLiveColors } from "../live/tokens";
import { Fold, useFold } from "./Fold";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveStackMenu } from "../../state/sidebar/liveMenus";
import { LiveItemRow } from "./LiveItemRow";
import { RefreshSpinner } from "./RefreshSpinner";
import { SectionLabel } from "./SectionLabel";
import { SidebarListRow } from "./SidebarRow";
import { TAB_ROW } from "./tokens";

const SECTION_HEIGHT = 22;

export function SectionTitle({ title }: { title: string }) {
  return <SectionLabel title={title} inset={TAB_ROW.contentLeft} top={SECTION_HEIGHT - space.xxs - lineHeight.caption} bottom={space.xxs} />;
}

export function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const body = (
    <SidebarListRow height={28} padRight={TAB_ROW.trailing} fill={onPress && hovered ? theme.rowHover : undefined} style={NOTE_GAP}>
      {spinner ? <Spinner /> : icon ? <Symbol name={icon} size={10} color={colors.pending} style={{ width: 16, height: 16 }} /> : null}
      <Text lines={2} size="small" tone="textSecondary" style={FILL}>
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

const NOTE_GAP = { gap: space.s } as const;
const FILL = { flex: 1 } as const;
const LABEL = { marginLeft: TAB_ROW.titleGap } as const;
const SPINNER = { width: 16, height: 16, alignItems: "center", justifyContent: "center" } as const;

function Spinner() {
  const theme = useTheme();
  return (
    <RefreshSpinner style={SPINNER}>
      <Symbol name="arrow.triangle.2.circlepath" size={10} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
    </RefreshSpinner>
  );
}

export function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={() => showAllIn(folderId, section)}>
        <SidebarListRow height={26} fill={hovered ? theme.rowHover : undefined}>
          <Symbol name="ellipsis" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          <Text size="small" tone="textSecondary" style={LABEL}>
            Show {count} More
          </Text>
        </SidebarListRow>
      </Pressable>
    </View>
  );
}

const STACK_TITLE = { flex: 1, marginLeft: TAB_ROW.titleGap } as const;
const STACK_COUNT = { marginRight: space.xs } as const;

export function StackRow({ folderId, windowId, stack }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }> }) {
  const theme = useTheme();
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
            <SidebarListRow height={26} padRight={space.m} fill={hovered ? theme.rowHover : undefined}>
              <Symbol name="square.stack.3d.up" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
              <Text lines={1} size="small" weight="medium" tone="textSecondary" style={STACK_TITLE}>
                {repo} stack
              </Text>
              <View style={STACK_COUNT}>
                <Badge text={stack.items.length} size="m" />
              </View>
              <Symbol name={collapsed ? "chevron.right" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 12 }} />
            </SidebarListRow>
          </Pressable>
        </ContextMenuArea>
      </View>
      <Fold
        fold={fold}
        collapsed={collapsed}
        entries={stack.items.map((item) => ({ key: item.id, node: <LiveItemRow folderId={folderId} item={item} windowId={windowId} inStack /> }))}
        rowHeight={layout.rowHeight}
        padTop={layout.rowGap}
      />
    </View>
  );
}
