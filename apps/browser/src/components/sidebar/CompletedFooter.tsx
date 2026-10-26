import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { openLiveItem } from "../../state/live/engine";
import { useLive } from "../../state/live/store";
import type { CompletedItem } from "../../state/live/types";
import { FadeLabel, font, radius, Symbol } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { COMPLETION_GLYPH } from "./LiveItemRow";
import { SIDEBAR_TYPE } from "./tokens";

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
      <View style={{ height: 24, flexDirection: "row", alignItems: "center", paddingLeft: 9, borderRadius: radius.l, backgroundColor: open ? theme.rowHover : undefined }}>
        <Symbol name="checkmark.circle" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
        <Text style={{ marginLeft: 5, ...font.small, color: theme.textSecondary }}>{shown.length} Completed</Text>
      </View>
      {open
        ? shown.slice(0, 8).map((c) => (
            <Pressable key={c.item.id} onPress={() => openLiveItem(windowId, folderId, c.item)}>
              {({ pressed }) => (
                <View style={{ height: 28, borderRadius: radius.l, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: pressed ? theme.tabPressed : undefined, opacity: 0.75 }}>
                  <Symbol name={COMPLETION_GLYPH[c.state].symbol} size={12} color={colors[COMPLETION_GLYPH[c.state].color]} style={{ width: 16, height: 16 }} />
                  <FadeLabel text={c.item.title} fontSize={SIDEBAR_TYPE.compact} color={theme.textSecondary} style={{ flex: 1, height: 17, marginLeft: 5 }} />
                </View>
              )}
            </Pressable>
          ))
        : null}
    </View>
  );
}
