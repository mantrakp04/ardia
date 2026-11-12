import { useState } from "react";
import { Image, View } from "react-native";
import { setAttachedOpen, setIncludePages, setTrace } from "../../state/report/actions";
import { formatBytes, formatDuration, TRACE_MAX_SECONDS } from "../../state/report/form";
import { useReport, useReportShallow, useReportWindowIsPrivate } from "../../state/report/hooks";
import { discardRecording, startRecording } from "../../state/report/recording";
import { ActivitySpinner, Box, Button, Checkbox, Dot, ink, radius, ReportVideo, space, Symbol, Text, useTheme } from "../ui";
import { REPORT } from "./tokens";

const RECORD_HINT = "Records this window, its Picture in Picture and the menus and prompts it opens. Never your other windows. Reports with a recording get fixed first.";
const PAGES_WARNING =
  "Pages and Picture in Picture videos can show private things like email, messages or bank details. Only include them if nothing sensitive is on screen. Tab names, addresses and what Ardia itself shows about a page, like suggestions and media controls, always show. WebKit pages with audio or video, where streaming services play, stay black. You'll watch it before it's sent.";
const PRIVATE_NOTE = "Pages always stay hidden when you record a private window. Tab names and addresses still show.";

export function RecordSection() {
  const recording = useReport((s) => s.recording);
  const { includePages, kind, trace } = useReportShallow((s) => ({ includePages: s.draft.includePages, kind: s.draft.kind, trace: s.draft.trace }));
  const [watching, setWatching] = useState(false);
  const attachedOpen = useReport((s) => s.attachedOpen);
  const privateWindow = useReportWindowIsPrivate();
  const watch = (on: boolean) => {
    if (on) setAttachedOpen(false);
    setWatching(on);
  };
  const recorded = recording.phase === "ready";
  return (
    <Box fill="groupFill" border="groupBorder" radius="panel" pad="l" gap="ml">
      {recording.phase === "ready" ? (
        <Recorded
          path={recording.path}
          thumbnail={recording.thumbnail}
          seconds={recording.seconds}
          bytes={recording.bytes}
          pages={recording.includePages}
          pictureInPicture={!!recording.pictureInPicture}
          watching={watching && !attachedOpen}
          onWatch={watch}
        />
      ) : recording.phase === "saving" ? (
        <Box row gap="m" style={CENTER_ROW}>
          <ActivitySpinner style={SPINNER} />
          <Text tone="textSecondary">Saving the recording…</Text>
        </Box>
      ) : (
        <Box row gap="l" style={CENTER_ROW}>
          <Button title="Record the problem" icon="record.circle" onPress={() => void startRecording()} />
          <Text size="small" tone={recording.phase === "failed" ? "destructive" : "textSecondary"} style={FLEX}>
            {recording.phase === "failed" ? recording.message : RECORD_HINT}
          </Text>
        </Box>
      )}
      {kind === "slow" ? <TraceRow on={trace} locked={recorded} /> : null}
      <PagesChoice on={includePages && !privateWindow} locked={recorded} privateWindow={privateWindow} />
    </Box>
  );
}

function Recorded({
  path,
  thumbnail,
  seconds,
  bytes,
  pages,
  pictureInPicture,
  watching,
  onWatch,
}: {
  path: string;
  thumbnail: string | null;
  seconds: number;
  bytes: number;
  pages: boolean;
  pictureInPicture: boolean;
  watching: boolean;
  onWatch: (on: boolean) => void;
}) {
  const theme = useTheme();
  const actions = (
    <Box row gap="l" style={ACTIONS}>
      <Button variant="text" look="link" pad="none" title={watching ? "Hide" : "Watch"} onPress={() => onWatch(!watching)} />
      <Button variant="text" look="link" pad="none" title="Record again" onPress={() => void startRecording()} />
      <Button
        variant="text"
        look="link"
        tone="destructive"
        title="Remove"
        onPress={() => {
          onWatch(false);
          discardRecording();
        }}
      />
    </Box>
  );
  const summary = `Recording · ${formatDuration(seconds)} · ${pages ? "pages included" : "pages hidden"}${pictureInPicture ? " · with Picture in Picture" : ""}`;
  if (watching)
    return (
      <View style={{ gap: space.m }}>
        <View style={{ height: REPORT.player.height, borderRadius: radius.tile, overflow: "hidden" }}>
          <ReportVideo path={path} playing style={FLEX} />
        </View>
        <Box row gap="m" style={CENTER_ROW}>
          <Text weight="semibold" style={FLEX}>
            {summary}
          </Text>
          {actions}
        </Box>
      </View>
    );
  return (
    <Box row gap="l" style={CENTER_ROW}>
      <View style={{ width: REPORT.thumbnail.width, height: REPORT.thumbnail.height, borderRadius: radius.tile, overflow: "hidden", backgroundColor: ink.black }}>
        {thumbnail ? <Image source={{ uri: `file://${thumbnail}` }} resizeMode="cover" style={FILL} /> : null}
        <View style={BADGE}>
          <Text size="tiny" weight="semibold" color={ink.white} style={{ backgroundColor: theme.scrim, paddingHorizontal: space.xs, borderRadius: radius.control }}>
            {formatDuration(seconds)}
          </Text>
        </View>
      </View>
      <View style={FLEX}>
        <Text weight="semibold">{summary}</Text>
        <Text size="small" tone="textSecondary">{`${formatBytes(bytes)} · You'll watch it before it's sent.`}</Text>
        {actions}
      </View>
    </Box>
  );
}

function TraceRow({ on, locked }: { on: boolean; locked: boolean }) {
  const trace = useReport((s) => s.trace);
  const status =
    trace.phase === "ready"
      ? `Trace attached · ${Math.round(trace.seconds)} s · ${formatBytes(trace.bytes)}`
      : trace.phase === "tracing"
        ? "Recording a trace…"
        : trace.phase === "saving"
          ? "Saving the trace…"
          : trace.phase === "failed"
            ? "The trace couldn't be recorded."
            : `Records what the engine does for up to ${TRACE_MAX_SECONDS} seconds while you record.`;
  return (
    <Box row gap="m" style={TOP_ROW}>
      <Checkbox value={on} onChange={setTrace} disabled={locked} />
      <View style={FLEX}>
        <Text>Record a performance trace</Text>
        <Text size="small" tone={trace.phase === "failed" ? "destructive" : "textSecondary"}>
          {status}
        </Text>
      </View>
    </Box>
  );
}

function PagesChoice({ on, locked, privateWindow }: { on: boolean; locked: boolean; privateWindow: boolean }) {
  const theme = useTheme();
  return (
    <Box row gap="m" style={TOP_ROW}>
      <Checkbox value={on} onChange={setIncludePages} disabled={locked || privateWindow} />
      <View style={FLEX}>
        <Text tone={locked ? "textSecondary" : "textPrimary"}>Include web pages</Text>
        {privateWindow ? (
          <Text size="small" tone="textSecondary" style={{ marginTop: space.xxs }}>
            {PRIVATE_NOTE}
          </Text>
        ) : locked ? (
          <Box row gap="xs" style={CENTER_ROW}>
            <Symbol name="lock" size={10} color={theme.textTertiary} style={LOCK} />
            <Text size="small" tone="textSecondary">
              Applies to the next recording ·
            </Text>
            <Button variant="text" look="link" pad="none" title="Record again" onPress={() => void startRecording()} />
          </Box>
        ) : (
          <Text size="small" tone="textSecondary" style={{ marginTop: space.xxs }}>
            {PAGES_WARNING}
          </Text>
        )}
      </View>
      {on && !locked ? <Dot size={REPORT.recordDot} color={theme.warning} style={DOT} /> : null}
    </Box>
  );
}

const FLEX = { flex: 1 } as const;
const FILL = { width: "100%", height: "100%" } as const;
const CENTER_ROW = { alignItems: "center" } as const;
const TOP_ROW = { alignItems: "flex-start" } as const;
const ACTIONS = { marginTop: space.xs } as const;
const SPINNER = { width: 14, height: 14 } as const;
const LOCK = { width: 12, height: 12 } as const;
const DOT = { marginTop: space.xs } as const;
const BADGE = { position: "absolute", right: space.xs, top: space.xs } as const;
