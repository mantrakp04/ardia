import { cancelDownload, keepDownload, pauseDownload, resumeDownload, type Download } from "../../state/downloads/actions";
import { openFile, revealFile } from "../../state/app/system";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useDownloads, useTab } from "../../state/browser/hooks";
import { clearDownloads, removeDownload } from "../../state/windows/actions";
import { openUrl } from "../../state/bookmarks/actions";
import { FileIcon } from "../downloads/Downloads";
import { useDownloadView } from "../downloads/useDownloadView";
import { downloadMenu } from "../../state/downloads/downloadMenu";
import { downloadStatus } from "../../state/downloads/status";
import { Box, Button, MouseArea, opacity, radius, space, Symbol, Text, useHover, useTheme } from "../ui";
import { EmptyState, hostLabel, matchesQuery, PAGE_WIDTH, PageHeader } from "./PageLayout";
import { downloadCard, EMPTY_ICON, emptyIcon, pageList, pageType } from "./tokens";

export function DownloadsPage({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const windowId = useTab(tabId, (t) => t?.windowId ?? "");
  const downloads = useDownloads(windowId, useShallow((list) => list));
  const [query, setQuery] = useState("");
  const shown = downloads.filter((d) => matchesQuery(query, d.filename, d.url));

  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title="Downloads"
        query={query}
        onQuery={setQuery}
        placeholder="Search downloads"
        actions={downloads.some((d) => d.state !== "downloading") ? <Button title="Clear All" onPress={() => clearDownloads(windowId)} /> : null}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<Symbol name="arrow.down.circle" size={emptyIcon.size} color={theme.textTertiary} style={EMPTY_ICON} />}
          title={query ? "No search results found" : "Files you download appear here"}
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(d) => d.id}
          contentContainerStyle={LIST}
          renderItem={({ item }) => <DownloadCard d={item} windowId={windowId} />}
        />
      )}
    </View>
  );
}

const LIST = { alignItems: "center", paddingTop: space.m, paddingBottom: pageList.endPad, gap: space.m } as const;
const CARD_WIDTH = { width: PAGE_WIDTH - 2 * space.xl, maxWidth: "100%" } as const;
const CARD = { alignItems: "center" } as const;
const CARD_TEXT = { flex: 1, gap: downloadCard.textGap } as const;
const ROW_BUTTONS = { flexDirection: "row", gap: space.m } as const;

function DownloadCard({ d, windowId }: { d: Download; windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const { exists, done, progress, blocked } = useDownloadView(d);
  return (
    <View {...hoverProps} style={CARD_WIDTH}>
      <MouseArea path={done ? d.path : null}>
        <Box row gap="lx" pad="lx" radius="panel" fill={hovered ? "rowHover" : "groupFill"} border="groupBorder" style={CARD}>
          <View style={{ opacity: exists ? 1 : opacity.disabled }}>
            <FileIcon path={d.path || d.filename} size={downloadCard.iconSize} />
          </View>
          <View style={CARD_TEXT}>
            <Pressable disabled={!done} onPress={() => void openFile(d.path)}>
              <Text
                lines={1}
                weight="medium"
                tone={exists ? "textPrimary" : "textSecondary"}
                style={{ fontSize: pageType.fileName, textDecorationLine: exists ? "none" : "line-through" }}
              >
                {d.filename || "Preparing…"}
              </Text>
            </Pressable>
            <Pressable onPress={() => openUrl(d.url, windowId, "foreground")}>
              <Text lines={1} size="small" tone="textTertiary">
                {hostLabel(d.url)}
              </Text>
            </Pressable>
            {d.state === "downloading" && !blocked && (
              <View style={{ height: downloadCard.progressHeight, borderRadius: downloadCard.progressRadius, marginTop: downloadCard.progressTop, backgroundColor: theme.rowHover }}>
                <View
                  style={{
                    width: `${Math.max(progress, downloadCard.progressMin) * 100}%`,
                    height: downloadCard.progressHeight,
                    borderRadius: downloadCard.progressRadius,
                    backgroundColor: d.paused ? theme.textTertiary : theme.accent,
                  }}
                />
              </View>
            )}
            <Text lines={1} size="small" tone={blocked ? "destructive" : "textSecondary"}>
              {downloadStatus(d, exists)}
            </Text>
          </View>
          {blocked ? (
            <View style={ROW_BUTTONS}>
              <Button title="Keep" onPress={() => void keepDownload(d.id)} />
              <Button title="Discard" kind="destructive" onPress={() => void cancelDownload(d.id)} />
            </View>
          ) : d.state === "downloading" ? (
            <View style={ROW_BUTTONS}>
              <Button title={d.paused ? "Resume" : "Pause"} onPress={() => void (d.paused ? resumeDownload(d.id) : pauseDownload(d.id))} />
              <Button title="Cancel" onPress={() => void cancelDownload(d.id)} />
            </View>
          ) : done ? (
            <Button title="Show in Finder" onPress={() => void revealFile(d.path)} />
          ) : null}
          <Button variant="icon" icon="ellipsis" size={13} box={downloadCard.menuBox} radius={radius.m} onPress={() => void downloadMenu(d, windowId)} tooltip="More actions" />
          {d.state !== "downloading" && (
            <Button variant="icon" icon="xmark" size={11} box={downloadCard.menuBox} radius={radius.m} onPress={() => removeDownload(d.id)} tooltip="Remove from List" />
          )}
        </Box>
      </MouseArea>
    </View>
  );
}
