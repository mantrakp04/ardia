import { pauseDownload, resumeDownload, type Download } from "@ardia/ardiacore";
import { retryDownload } from "../../lib/downloadRetry";
import { Symbol } from "@ardia/shell";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { DOWNLOAD_FILTERS, failedOrStopped, filterCounts, summarize, type DownloadFilter } from "../../lib/downloadManager";
import { useTheme } from "../../lib/theme";
import { formatBytes, formatDuration } from "../Downloads";
import { Button, useFormColors } from "../settings/controls";

export { retryDownload } from "../../lib/downloadRetry";
export function DownloadManagerBar({
  downloads,
  windowId,
  filter,
  onFilter,
}: {
  downloads: Download[];
  windowId: string;
  filter: DownloadFilter;
  onFilter: (f: DownloadFilter) => void;
}) {
  const theme = useTheme();
  const colors = useFormColors();
  const summary = useMemo(() => summarize(downloads), [downloads]);
  const counts = useMemo(() => filterCounts(downloads), [downloads]);
  const progress = summary.total > 0 ? summary.received / summary.total : 0;
  const status = summary.active
    ? [
        `${summary.active} downloading`,
        summary.paused ? `${summary.paused} paused` : null,
        summary.speed > 0 ? `${formatBytes(summary.speed)}/s` : null,
        summary.secondsLeft !== null ? formatDuration(summary.secondsLeft) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : `${downloads.length} ${downloads.length === 1 ? "file" : "files"}${summary.failed ? ` · ${summary.failed} failed` : ""}`;
  const failed = downloads.filter(failedOrStopped);
  return (
    <View style={{ gap: 10, paddingBottom: 10 }}>
      <View
        style={{
          padding: 14,
          gap: 10,
          borderRadius: 12,
          backgroundColor: colors.group,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.groupBorder,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Symbol name={summary.active ? "arrow.down.circle.fill" : "checkmark.circle"} size={18} color={summary.active ? theme.accent : theme.textSecondary} style={{ width: 22, height: 22 }} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>
            {status}
          </Text>
          {summary.running > 0 && <Button title="Pause All" onPress={() => downloads.forEach((d) => d.state === "downloading" && !d.paused && void pauseDownload(d.id))} />}
          {summary.paused > 0 && <Button title="Resume All" onPress={() => downloads.forEach((d) => d.state === "downloading" && d.paused && void resumeDownload(d.id))} />}
          {failed.length > 0 && <Button title="Retry Failed" onPress={() => failed.forEach((d) => retryDownload(d, windowId))} />}
        </View>
        {summary.active > 0 && (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.rowHover }}>
            <View style={{ width: `${Math.max(progress, 0.02) * 100}%`, height: 4, borderRadius: 2, backgroundColor: summary.running ? theme.accent : theme.textTertiary }} />
          </View>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {DOWNLOAD_FILTERS.filter((f) => f.id === "all" || f.id === filter || counts[f.id] > 0).map((f) => {
          const on = f.id === filter;
          return (
            <Pressable
              key={f.id}
              onPress={() => onFilter(f.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 11,
                height: 26,
                borderRadius: 13,
                backgroundColor: on ? theme.accent : colors.group,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: on ? theme.accent : colors.groupBorder,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: on ? "#FFFFFF" : theme.textPrimary }}>{f.title}</Text>
              <Text style={{ fontSize: 11, color: on ? "rgba(255,255,255,0.8)" : theme.textTertiary }}>{counts[f.id]}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
