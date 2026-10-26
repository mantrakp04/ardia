import { appUrlOrigin, displayHost, urlForDisplay } from "@ardia/core";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Box, SearchField, Text } from "../ui";
import { emptyState, pageHeader, pageType } from "./tokens";

export const PAGE_WIDTH = 880;

export function PageHeader({
  title,
  query,
  onQuery,
  placeholder,
  actions,
}: {
  title: string;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  actions?: ReactNode;
}) {
  return (
    <Box row padX="xxxl" gap="xl" style={HEADER_ROW}>
      <Text weight="semibold" style={HEADER_TITLE}>
        {title}
      </Text>
      <View style={HEADER_SEARCH}>
        <SearchField value={query} onChangeText={onQuery} placeholder={placeholder} style={SEARCH_FIELD} />
      </View>
      <Box row gap="m" style={HEADER_ACTIONS}>
        {actions}
      </Box>
    </Box>
  );
}

const HEADER_ROW = { height: pageHeader.height, alignItems: "center" } as const;
const HEADER_TITLE = { width: pageHeader.sideWidth, fontSize: pageType.title } as const;
const HEADER_SEARCH = { flex: 1, alignItems: "center" } as const;
const SEARCH_FIELD = { width: "100%", maxWidth: pageHeader.searchMaxWidth } as const;
const HEADER_ACTIONS = { width: pageHeader.sideWidth, justifyContent: "flex-end", alignItems: "center" } as const;

export function EmptyState({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <Box gap="m" center style={EMPTY}>
      {icon}
      <Text size="heading" weight="medium" tone="textSecondary">
        {title}
      </Text>
      {subtitle ? (
        <Text tone="textTertiary" style={EMPTY_SUBTITLE}>
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}

const EMPTY = { flex: 1, paddingBottom: emptyState.liftBottom } as const;
const EMPTY_SUBTITLE = { textAlign: "center", maxWidth: emptyState.subtitleMaxWidth } as const;

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

export function hostLabel(url: string): string {
  const app = appUrlOrigin(url);
  if (app) return app;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? displayHost(m[1]!.toLowerCase()).replace(/^www\./, "") : url;
}

export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export const searchText = (...fields: string[]) => fields.map((f) => (/xn--/i.test(f) ? `${f} ${urlForDisplay(f)}` : f)).join(" ").toLowerCase();

export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = queryWords(query);
  if (!words.length) return true;
  const hay = searchText(...fields);
  return words.every((w) => hay.includes(w));
}
