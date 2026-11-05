import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { openLiveItem } from "../../state/live/engine";
import { useLive } from "../../state/live/store";
import type { CompletedItem } from "../../state/live/types";
import { space, Symbol, Text } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { COMPLETION_GLYPH } from "./LiveItemRow";
import { SidebarListRow, SidebarRowLabel } from "./SidebarRow";
import { TAB_ROW } from "./tokens";

const LABEL = { marginLeft: TAB_ROW.titleGap } as const;
const DONE_ROW = { opacity: 0.75 } as const;

const NONE: string[] = [];
const NONE_COMPLETED: CompletedItem[] = [];

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
  const shown = useCompletedShown(folderId);
  const [open, setOpen] = useState(false);
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
    <View onMouseEnter={enter} onMouseLeave={leave} style={{ gap: layout.rowGap }}>
      <SidebarListRow height={24} fill={open ? theme.rowHover : undefined}>
        <Symbol name="checkmark.circle" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
        <Text size="small" tone="textSecondary" style={LABEL}>
          {shown.length} Completed
        </Text>
      </SidebarListRow>
      {open
        ? shown.slice(0, 8).map((c) => (
            <Pressable key={c.item.id} onPress={() => openLiveItem(windowId, folderId, c.item)}>
              {({ pressed }) => (
                <SidebarListRow height={28} padRight={space.m} fill={pressed ? theme.tabPressed : undefined} style={DONE_ROW}>
                  <Symbol name={COMPLETION_GLYPH[c.state].symbol} size={12} color={colors[COMPLETION_GLYPH[c.state].color]} style={{ width: 16, height: 16 }} />
                  <SidebarRowLabel text={c.item.title} color={theme.textSecondary} compact />
                </SidebarListRow>
              )}
            </Pressable>
          ))
        : null}
    </View>
  );
}
