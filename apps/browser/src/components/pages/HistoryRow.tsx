import { memo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { markHoverProps } from "../../lib/hoverMarks";
import type { HistoryEntry } from "../../state/browser/types";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import { Favicon } from "../favicon/Favicon";
import { Button, Checkbox, ContextMenuArea, HoverSlot, MouseArea, radius, space, Text, useTheme } from "../ui";
import { historyScroll } from "./historyLayout";
import { openHistoryRowMenu } from "../../state/history/historyMenus";
import { hostLabel, timeLabel } from "./PageLayout";
import { historyRow, pagesColors, pageType } from "./tokens";

const DAY_HEADER = { position: "absolute", left: 0, right: 0, height: historyRow.header, justifyContent: "flex-end", paddingBottom: space.m, paddingHorizontal: historyRow.headerInset } as const;
const DAY_LABEL = { fontSize: pageType.dayHeader } as const;
const ROW_FRAME = { height: historyRow.height, paddingHorizontal: space.xl } as const;
const TIME = { width: historyRow.timeWidth } as const;
const LINK = { flexDirection: "row", alignItems: "center", gap: space.ml } as const;
const TITLE = { flexShrink: 1 } as const;
const HOST = { flexShrink: 0, maxWidth: historyRow.hostMaxWidth } as const;
const SEPARATOR = { position: "absolute", left: space.xl + space.l, right: space.xl + space.l, bottom: 0, height: StyleSheet.hairlineWidth * 2 } as const;

export const DayHeader = memo(function DayHeader({ label, top }: { label: string; top: number }) {
  return (
    <View style={[DAY_HEADER, { top }]}>
      <Text weight="semibold" tone="textSecondary" style={DAY_LABEL}>
        {label}
      </Text>
    </View>
  );
});

export const HistoryRow = memo(function HistoryRow({
  entry,
  profileId,
  first,
  last,
  selected,
  selecting,
  windowId,
  onToggle,
  onMoreFromSite,
  onRemove,
  menuTargets,
}: {
  entry: HistoryEntry;
  profileId: string;
  first: boolean;
  last: boolean;
  selected: boolean;
  selecting: boolean;
  windowId: string;
  onToggle: (url: string, shift: boolean) => void;
  onMoreFromSite: (url: string) => void;
  onRemove: (urls: string[]) => void;
  menuTargets: (entry: HistoryEntry) => HistoryEntry[];
}) {
  const theme = useTheme();
  const url = useRef(entry.url);
  url.current = entry.url;
  const [hoveredUrl, setHoveredUrl] = useState<string | null>(null);
  const [restingUrl, setRestingUrl] = useState<string | null>(null);
  const [hoverProps] = useState(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const rest = (hoveredEntry: string) => {
      const wait = historyScroll.lastAt + historyRow.scrollSettleMs - Date.now();
      if (wait <= 0) setRestingUrl(hoveredEntry);
      else settle = setTimeout(() => rest(hoveredEntry), wait);
    };
    return markHoverProps({
      onMouseEnter: () => {
        clearTimeout(settle);
        setHoveredUrl(url.current);
        rest(url.current);
      },
      onMouseLeave: () => {
        clearTimeout(settle);
        setHoveredUrl(null);
        setRestingUrl(null);
      },
    });
  });
  const hovered = hoveredUrl === entry.url;
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const [focusProps] = useState(() => {
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    return {
      onFocus: () => {
        clearTimeout(blurTimer);
        setFocusedUrl(url.current);
      },
      onBlur: () => {
        clearTimeout(blurTimer);
        blurTimer = setTimeout(() => setFocusedUrl(null), 0);
      },
    };
  });
  const showControls = restingUrl === entry.url || focusedUrl === entry.url;
  const menu = () => openHistoryRowMenu(menuTargets(entry), windowId, onMoreFromSite, onRemove);
  const r = radius.card;
  return (
    <View {...hoverProps} {...focusProps} style={ROW_FRAME}>
      <ContextMenuArea onContextMenu={() => void menu()} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.l,
            gap: space.l,
            backgroundColor: selected ? (theme.dark ? pagesColors.dark : pagesColors.light).rowSelected : hovered ? theme.rowHover : theme.groupFill,
            borderTopLeftRadius: first ? r : 0,
            borderTopRightRadius: first ? r : 0,
            borderBottomLeftRadius: last ? r : 0,
            borderBottomRightRadius: last ? r : 0,
          }}
        >
          <HoverSlot hovered={showControls || selecting} width={historyRow.checkbox} hover={<Checkbox value={selected} onChange={() => onToggle(entry.url, false)} />} />
          <Text size="small" tone="textSecondary" style={TIME}>
            {timeLabel(entry.lastVisit)}
          </Text>
          <MouseArea style={{ flex: 1 }} onMiddleClick={() => openUrl(entry.url, windowId, "background")}>
            <Pressable
              onPress={(e) => {
                const ev = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
                if (selecting) return onToggle(entry.url, !!ev.shiftKey);
                openUrl(entry.url, windowId, openModeFor(ev));
              }}
              accessibilityActions={[
                { name: "select", label: selected ? "Deselect" : "Select" },
                { name: "menu", label: "More Actions" },
              ]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "select") onToggle(entry.url, false);
                if (e.nativeEvent.actionName === "menu") void menu();
              }}
              style={LINK}
            >
              <Favicon url={entry.url} favicon={entry.favicon} profileId={profileId} />
              <Text lines={1} style={TITLE}>
                {entry.title || entry.url}
              </Text>
              <Text lines={1} size="small" tone="textTertiary" style={HOST}>
                {hostLabel(entry.url)}
              </Text>
            </Pressable>
          </MouseArea>
          <HoverSlot hovered={showControls} width={historyRow.menuBox} hover={<Button variant="icon" icon="ellipsis" size={13} box={historyRow.menuBox} radius={radius.m} onPress={() => void menu()} tooltip="More actions" />} />
        </View>
      </ContextMenuArea>
      {!last && <View style={[SEPARATOR, { backgroundColor: theme.divider }]} />}
    </View>
  );
});
