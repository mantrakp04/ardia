import { useState } from "react";
import { View } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { closeReport, sendCurrentReport, setContact, setDescription, setKind, setTitle, setWatch } from "../../state/report/actions";
import { canSend, formatDay, REPORT_KINDS, titleCounter, watchEndDate } from "../../state/report/form";
import { useReport, useReportOpenIn, useReportShallow } from "../../state/report/hooks";
import { isBusy, uploadFraction } from "../../state/report/upload";
import { useTelemetry } from "../../state/telemetry/choice";
import { Box, Button, Checkbox, Dialog, ProgressTrack, Segmented, space, Text, TextField } from "../ui";
import { AttachedPopover, AttachedRow } from "./AttachedRow";
import { RecordSection } from "./RecordSection";
import { ReportPreview } from "./ReportPreview";
import { SentView } from "./SentView";
import { REPORT } from "./tokens";

const FOOTER_NOTE = "Your title and description become a public GitHub issue. Recordings, contact and details stay private.";
const MISSING_HINT = "Add a title and description";

export function ReportSheetHost() {
  const windowId = useWindowId();
  const open = useReportOpenIn(windowId);
  const hidden = useReport((s) => s.recording.phase === "starting" || s.recording.phase === "recording");
  const sent = useReport((s) => s.sent);
  if (!open || hidden) return null;
  if (sent) return <SentView sent={sent} />;
  return <ReportForm />;
}

function ReportForm() {
  const preview = useReport((s) => s.preview);
  const attachedOpen = useReport((s) => s.attachedOpen);
  const ready = useReport((s) => canSend(s.draft) && !isBusy(s.upload) && s.recording.phase !== "saving" && s.trace.phase !== "tracing" && s.trace.phase !== "saving");
  const [rowTop, setRowTop] = useState(0);
  const [height, setHeight] = useState(0);
  return (
    <Dialog width="xl" animated onDismiss={() => void closeReport()} onSubmit={() => ready && void sendCurrentReport()}>
      {preview ? (
        <ReportPreview />
      ) : (
        <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
          <Header />
          <Fields />
          <View style={{ marginTop: space.l }}>
            <RecordSection />
          </View>
          <View style={{ marginTop: space.l }} onLayout={(e) => setRowTop(e.nativeEvent.layout.y)}>
            <AttachedRow />
          </View>
          <Watch />
          <Contact />
          <Footer ready={ready} />
          {attachedOpen ? <AttachedPopover bottom={height - rowTop + space.xs} /> : null}
        </View>
      )}
    </Dialog>
  );
}

function Header() {
  const kind = useReport((s) => s.draft.kind);
  return (
    <Box row gap="l" style={CENTER_ROW}>
      <Text size="title" weight="semibold" style={FLEX}>
        Report a Problem
      </Text>
      <Segmented options={REPORT_KINDS.map((k) => ({ value: k.value, title: k.title }))} value={kind} onChange={setKind} />
      <Button variant="close" look="panel" tooltip="Close" onPress={() => void closeReport()} />
    </Box>
  );
}

function Fields() {
  const { title, description } = useReportShallow((s) => ({ title: s.draft.title, description: s.draft.description }));
  const counter = titleCounter(title);
  return (
    <>
      <Box row style={{ marginTop: space.xl, marginBottom: space.s, alignItems: "baseline" }}>
        <Text weight="medium" tone="textSecondary" style={FLEX}>
          Title
        </Text>
        <Text size="small" weight={counter.full ? "semibold" : "regular"} tone={counter.full ? "destructive" : "textTertiary"} accessibilityLabel={`${counter.count} of ${counter.max} characters`}>
          {`${counter.count}/${counter.max}`}
        </Text>
      </Box>
      <TextField value={title} onChangeText={setTitle} placeholder="Sidebar tabs flicker after waking from sleep" invalid={counter.full} autoFocus />
      <Text weight="medium" tone="textSecondary" style={{ marginTop: space.l, marginBottom: space.s }}>
        What happened?
      </Text>
      <TextField value={description} onChangeText={setDescription} placeholder="What did you do, what did you expect, what happened instead?" multiline />
    </>
  );
}

function Watch() {
  const sharing = useTelemetry((t) => t.sharing);
  const watch = useReport((s) => s.draft.watch);
  if (sharing) return null;
  return (
    <Box row gap="m" style={{ marginTop: space.l, alignItems: "flex-start" }}>
      <Checkbox value={watch} onChange={setWatch} />
      <View style={FLEX}>
        <Text onPress={() => setWatch(!watch)}>Help confirm the fix: share crash reports and usage for 14 days</Text>
        <Text size="small" tone="textSecondary">{`Turns itself off on ${formatDay(watchEndDate(Date.now()))}.`}</Text>
      </View>
    </Box>
  );
}

function Contact() {
  const contact = useReport((s) => s.draft.contact);
  return (
    <Box row gap="l" style={{ marginTop: space.l, alignItems: "center" }}>
      <Text weight="medium" tone="textSecondary" style={{ width: REPORT.labelWidth }}>
        Contact
      </Text>
      <TextField value={contact} onChangeText={setContact} placeholder="@handle or email, if you'd like a reply" style={FLEX} />
    </Box>
  );
}

function Footer({ ready }: { ready: boolean }) {
  const upload = useReport((s) => s.upload);
  const missing = useReport((s) => !canSend(s.draft));
  const busy = isBusy(upload);
  const failed = upload.phase === "failed" ? upload : null;
  const percent = Math.round(uploadFraction(upload) * 100);
  return (
    <Box row gap="m" style={{ marginTop: space.xl, alignItems: "center" }}>
      <View style={FLEX}>
        {busy ? (
          <View style={{ gap: space.xs }}>
            <Text size="small" tone="textSecondary">
              {upload.phase === "creating" ? "Sending…" : upload.phase === "completing" ? "Finishing…" : `Uploading… ${percent}%`}
            </Text>
            <ProgressTrack value={upload.phase === "creating" ? 0.02 : uploadFraction(upload)} tone="formAccent" />
          </View>
        ) : failed ? (
          <Text size="small" tone="destructive">{`Couldn't send. ${failed.message} Your draft is kept.`}</Text>
        ) : (
          <Text size="caption" tone="textSecondary">
            {FOOTER_NOTE}
          </Text>
        )}
      </View>
      <Button title="Cancel" onPress={() => void closeReport()} />
      <View tooltip={missing ? MISSING_HINT : undefined} accessibilityHint={missing ? MISSING_HINT : undefined}>
        <Button title={failed ? "Try Again" : busy ? "Sending…" : "Send"} kind="primary" disabled={!ready} onPress={() => void sendCurrentReport()} />
      </View>
    </Box>
  );
}

const FLEX = { flex: 1 } as const;
const CENTER_ROW = { alignItems: "center" } as const;
