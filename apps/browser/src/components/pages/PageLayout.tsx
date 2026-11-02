import { appUrlOrigin, urlForDisplay } from "@ardia/core";
import { displayHostOf } from "../../lib/url";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Box, display, SearchField, space, Text, useTheme, WindowDragRegion } from "../ui";
import { pageHeader, pageToolbar } from "./tokens";

export const PAGE_WIDTH = 880;

export type PageToolbarSize = keyof typeof pageToolbar;

export function PageToolbar({ size, divider, drag, children }: { size: PageToolbarSize; divider?: boolean; drag?: boolean; children: ReactNode }) {
  const theme = useTheme();
  const bar = pageToolbar[size];
  return (
    <View
      style={{
        height: bar.height,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: space[bar.padX],
        gap: space[bar.gap],
        borderTopWidth: divider ? StyleSheet.hairlineWidth * 2 : undefined,
        borderTopColor: divider ? theme.divider : undefined,
      }}
    >
      {drag ? <WindowDragRegion style={StyleSheet.absoluteFill} /> : null}
      {children}
    </View>
  );
}

export function PageHeader({ title, query, onQuery, actions }: { title: string; query: string; onQuery: (q: string) => void; actions?: ReactNode }) {
  return (
    <PageToolbar size="page">
      <Text weight="semibold" style={HEADER_TITLE}>
        {title}
      </Text>
      <View style={HEADER_SEARCH}>
        <View style={SEARCH_WIDTH}>
          <SearchField value={query} onChangeText={onQuery} placeholder={`Search ${title.toLowerCase()}`} />
        </View>
      </View>
      <Box row gap="m" style={HEADER_ACTIONS}>
        {actions}
      </Box>
    </PageToolbar>
  );
}

const HEADER_TITLE = { width: pageHeader.sideWidth, ...display.title } as const;
const HEADER_SEARCH = { flex: 1, alignItems: "center" } as const;
const SEARCH_WIDTH = { width: "100%", maxWidth: pageHeader.searchMaxWidth } as const;
const HEADER_ACTIONS = { width: pageHeader.sideWidth, justifyContent: "flex-end", alignItems: "center" } as const;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function dayLabel(start: number, now = Date.now()): string {
  const d = new Date(start);
  const full = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const today = dayStart(now);
  if (start === today) return `Today – ${full}`;
  if (start === dayStart(today - 1)) return `Yesterday – ${full}`;
  return full;
}

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const hostLabel = (url: string) => appUrlOrigin(url) || displayHostOf(url) || url;

export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export const searchText = (...fields: string[]) => fields.map((f) => (/xn--/i.test(f) ? `${f} ${urlForDisplay(f)}` : f)).join(" ").toLowerCase();

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = queryWords(query);
  if (!words.length) return true;
  const hay = searchText(...fields);
  return words.every((w) => hay.includes(w));
}
