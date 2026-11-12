import { View } from "react-native";
import { useWindowId } from "../../state/browser/hooks";
import { closeReport, mayStartSending, sendCurrentReport, setContact, setDescription, setKind, setTitle, setWatch } from "../../state/report/actions";
import { draftProblems, fieldProblem, formatDay, REPORT_KINDS, titleCounter, watchEndDate, type DraftField } from "../../state/report/form";
import { useReport, useReportOpenIn, useReportShallow } from "../../state/report/hooks";
import { isBusy, uploadFraction } from "../../state/report/upload";
import { useTelemetry } from "../../state/telemetry/choice";
import { Box, Button, Checkbox, Dialog, ProgressTrack, Segmented, space, Text, TextField } from "../ui";
import { AttachedRow } from "./AttachedRow";
import { RecordSection } from "./RecordSection";
import { ReportPreview } from "./ReportPreview";
import { SentView } from "./SentView";
import { REPORT } from "./tokens";

const FOOTER_NOTE = "Your title and description become a public GitHub issue. Recordings, contact and details stay private.";

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
  const ready = useReport(mayStartSending);
  return (
    <Dialog width="xl" animated onDismiss={() => void closeReport()} onSubmit={() => void sendCurrentReport()}>
      {preview ? (
        <ReportPreview />
      ) : (
        <View>
          <Header />
          <Fields />
          <View style={{ marginTop: space.l }}>
            <RecordSection />
          </View>
          <View style={{ marginTop: space.l }}>
            <AttachedRow />
          </View>
          <Watch />
          <Contact />
          <Footer ready={ready} />
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

function useFieldHint(field: DraftField) {
  return useReport((s) => (s.showProblems ? (fieldProblem(draftProblems(s.draft), field)?.hint ?? null) : null));
}

function FieldHint({ hint }: { hint: string | null }) {
  if (!hint) return null;
  return (
    <Text size="small" weight="medium" tone="destructive">
      {hint}
    </Text>
  );
}

function Fields() {
  const { title, description } = useReportShallow((s) => ({ title: s.draft.title, description: s.draft.description }));
  const titleHint = useFieldHint("title");
  const descriptionHint = useFieldHint("description");
  const counter = titleCounter(title);
  return (
    <>
      <Box row gap="m" style={{ marginTop: space.xl, marginBottom: space.s, alignItems: "baseline" }}>
        <Text weight="medium" tone="textSecondary" style={FLEX}>
          Title
        </Text>
        <FieldHint hint={titleHint} />
        <Text size="small" weight={counter.full ? "semibold" : "regular"} tone={counter.full ? "destructive" : "textTertiary"} accessibilityLabel={`${counter.count} of ${counter.max} characters`}>
          {`${counter.count}/${counter.max}`}
        </Text>
      </Box>
      <TextField value={title} onChangeText={setTitle} placeholder="Sidebar tabs flicker after waking from sleep" invalid={counter.full || !!titleHint} autoFocus />
      <Box row gap="m" style={{ marginTop: space.l, marginBottom: space.s, alignItems: "baseline" }}>
        <Text weight="medium" tone="textSecondary" style={FLEX}>
          What happened?
        </Text>
        <FieldHint hint={descriptionHint} />
      </Box>
      <TextField value={description} onChangeText={setDescription} placeholder="What did you do, what did you expect, what happened instead?" multiline invalid={!!descriptionHint} />
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
  const hint = useFieldHint("contact");
  return (
    <Box row gap="l" style={{ marginTop: space.l, alignItems: "center" }}>
      <Text weight="medium" tone="textSecondary" style={{ width: REPORT.labelWidth }}>
        Contact
      </Text>
      <TextField value={contact} onChangeText={setContact} placeholder="@handle or email, if you'd like a reply" invalid={!!hint} style={FLEX} />
      <FieldHint hint={hint} />
    </Box>
  );
}

function Footer({ ready }: { ready: boolean }) {
  const upload = useReport((s) => s.upload);
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
          <Text size="small" tone="destructive">{failed.message}</Text>
        ) : (
          <Text size="caption" tone="textSecondary">
            {FOOTER_NOTE}
          </Text>
        )}
      </View>
      <Button title="Cancel" onPress={() => void closeReport()} />
      <Button title={failed ? "Try Again" : busy ? "Sending…" : "Send"} kind="primary" disabled={!ready} onPress={() => void sendCurrentReport()} />
    </Box>
  );
}

const FLEX = { flex: 1 } as const;
const CENTER_ROW = { alignItems: "center" } as const;
