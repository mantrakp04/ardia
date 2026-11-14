import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { openLiveItem } from "../../state/live/engine";
import { useLive } from "../../state/live/store";
import type { CompletedItem } from "../../state/live/types";
import { Symbol, Text } from "../ui";
import { useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { Fold, useFold } from "./Fold";
import { COMPLETION_GLYPH } from "./LiveItemRow";
import { SidebarListRow, SidebarRowLabel } from "./SidebarRow";
import { useSidebarScale } from "./scale";

const DONE_ROW = { opacity: 0.75 } as const;

const NONE: string[] = [];
const NONE_COMPLETED: CompletedItem[] = [];
const COMPLETED_ROW_HEIGHT = 28;
const SUMMARY_ROW_HEIGHT = 24;
const SUMMARY_GLYPH = 11;
const DONE_GLYPH = 12;

export function useCompletedShown(folderId: string): CompletedItem[] {
  return useLive(
    useShallow((s) => {
      if (!s.folders[folderId]?.showCompleted) return NONE_COMPLETED;
      const completing = s.completing[folderId] ?? NONE;
      return (s.completed[folderId] ?? []).filter((c) => Date.now() - c.at < 24 * 3_600_000 && !completing.includes(c.item.id));
    }),
  );
}

export function CompletedFooter({ folderId, windowId }: { folderId: string; windowId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const m = useSidebarScale();
  const shown = useCompletedShown(folderId);
  const [open, setOpen] = useState(false);
  const fold = useFold(!open);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  if (!shown.length) return null;
  const enter = () => {
    clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 250);
  };
  return (
    <View onMouseEnter={enter} onMouseLeave={leave}>
      <SidebarListRow height={m.px(SUMMARY_ROW_HEIGHT)} fill={open ? theme.rowHover : undefined}>
        <Symbol name="checkmark.circle" size={m.px(SUMMARY_GLYPH)} color={theme.textSecondary} style={{ width: m.icon, height: m.icon }} />
        <Text size="small" tone="textSecondary" style={{ fontSize: m.font.small, marginLeft: m.tabRow.titleGap }}>
          {shown.length} Completed
        </Text>
      </SidebarListRow>
      <Fold
        fold={fold}
        collapsed={!open}
        entries={shown.slice(0, 8).map((c) => ({
          key: c.item.id,
          node: (
            <Pressable onPress={() => openLiveItem(windowId, folderId, c.item)}>
              {({ pressed }) => (
                <SidebarListRow height={m.px(COMPLETED_ROW_HEIGHT)} padRight={m.space.m} fill={pressed ? theme.tabPressed : undefined} style={DONE_ROW}>
                  <Symbol name={COMPLETION_GLYPH[c.state].symbol} size={m.px(DONE_GLYPH)} color={colors[COMPLETION_GLYPH[c.state].color]} style={{ width: m.icon, height: m.icon }} />
                  <SidebarRowLabel text={c.item.title} color={theme.textSecondary} compact />
                </SidebarListRow>
              )}
            </Pressable>
          ),
        }))}
        rowHeight={m.px(COMPLETED_ROW_HEIGHT)}
        padTop={m.rowGap}
      />
    </View>
  );
}
