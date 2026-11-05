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
import { Box, Button, EmptyState, MouseArea, opacity, ProgressTrack, space, Text, useHover } from "../ui";
import { hostLabel, matchesQuery, PAGE_WIDTH, PageHeader } from "./PageLayout";
import { downloadCard, pageList, pageType } from "./tokens";

export function DownloadsPage({ tabId }: { tabId: string }) {
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
        actions={downloads.some((d) => d.state !== "downloading") ? <Button title="Clear All" onPress={() => clearDownloads(windowId)} /> : null}
      />
      {shown.length === 0 ? (
        <EmptyState
          symbol="arrow.down.circle"
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
const PROGRESS = { marginTop: downloadCard.progressTop } as const;

function DownloadCard({ d, windowId }: { d: Download; windowId: string }) {
  const { hovered, hoverProps } = useHover();
  const { exists, done, progress, blocked } = useDownloadView(d);
  return (
    <View {...hoverProps} style={CARD_WIDTH}>
      <MouseArea path={done ? d.path : null}>
        <Box row gap="xl" pad="xl" radius="panel" fill={hovered ? "rowHover" : "groupFill"} border="groupBorder" style={CARD}>
          <View style={{ opacity: exists ? 1 : opacity.disabled }}>
            <FileIcon path={d.path || d.filename} size={downloadCard.iconSize} />
          </View>
          <View style={CARD_TEXT}>
            <Pressable disabled={!done} onPress={() => void openFile(d.path)}>
              <Text
                lines={1}
                weight="medium"
                tone={exists ? "textPrimary" : "textSecondary"}
                style={{ ...pageType.fileName, textDecorationLine: exists ? "none" : "line-through" }}
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
              <ProgressTrack
                value={Math.max(progress, downloadCard.progressMin)}
                height={downloadCard.progressHeight}
                tone={d.paused ? "textTertiary" : "accent"}
                style={PROGRESS}
              />
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
          <Button variant="icon" icon="ellipsis" size="l" onPress={() => void downloadMenu(d, windowId)} tooltip="More actions" />
          {d.state !== "downloading" && (
            <Button variant="icon" icon="xmark" size="l" onPress={() => removeDownload(d.id)} tooltip="Remove from List" />
          )}
        </Box>
      </MouseArea>
    </View>
  );
}
