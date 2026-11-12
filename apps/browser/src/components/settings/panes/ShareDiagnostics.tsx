import { useState } from "react";
import { ScrollView, View } from "react-native";
import { setSharing, useTelemetry } from "../../../state/telemetry/client";
import { IDENTITY_COPY, LOCAL_COPY, SHARING_COPY, WATCH_COPY, WHATS_SENT } from "../../../state/telemetry/copy";
import { identityFor, resetAnonymousId, shortInstallId, stopWatch, useInstallId, useWatchReport, useWatchTurnedSharingOn, useWatchUntil, viewMyData } from "../../../state/telemetry/privacy";
import { UI_LOCALE } from "../../../lib/uiLocale";
import { Button, DialogActions, DialogTitle, lineHeight, proseLineHeight, Sheet, space, Text, Toggle } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { AnonymousAvatar } from "../AnonymousAvatar";

const AVATAR_SIZE = 28;

const longDate = (ms: number) => new Date(ms).toLocaleDateString(UI_LOCALE, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ShareDiagnosticsSection() {
  const sharing = useTelemetry((s) => s.sharing);
  return (
    <>
      <SectionHeader title="Crash reports and usage" description={SHARING_COPY.dailyCountShort} />
      <Group>
        <Row anchor="privacy.shareDiagnostics" title={SHARING_COPY.toggle} description={SHARING_COPY.summary}>
          <Toggle value={sharing} onChange={(on) => setSharing(on, "settings")} />
        </Row>
        <WatchRow />
        <IdentityRow />
        <Row anchor="privacy.whatsSent" title={SHARING_COPY.whatsSent} onPress={() => showSettingsSheet(<WhatsSentSheet />)} />
      </Group>
      <KeptOnThisMac />
    </>
  );
}

function WatchRow() {
  const report = useWatchReport();
  const until = useWatchUntil();
  const turnedSharingOn = useWatchTurnedSharingOn();
  if (!report || until === null) return null;
  const detail = turnedSharingOn ? WATCH_COPY.rowDetail(report, longDate(until)) : WATCH_COPY.rowDetailAlreadySharing(report, longDate(until));
  return (
    <Row title={WATCH_COPY.rowTitle} description={detail}>
      <Button title={WATCH_COPY.stop} onPress={stopWatch} />
    </Row>
  );
}

function IdentityRow() {
  const installId = useInstallId();
  if (!installId) return <Row anchor="privacy.anonymousId" title={IDENTITY_COPY.noId} description={IDENTITY_COPY.noIdDetail} />;
  const { name, avatar } = identityFor(installId);
  return (
    <Row
      anchor="privacy.anonymousId"
      icon={<AnonymousAvatar avatar={avatar} size={AVATAR_SIZE} />}
      title={IDENTITY_COPY.appearAs(name)}
      description={IDENTITY_COPY.idDetail(shortInstallId(installId))}
    >
      <Button title={IDENTITY_COPY.reset} onPress={() => showSettingsSheet(<ResetIdSheet />)} />
    </Row>
  );
}

function KeptOnThisMac() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const result = await viewMyData();
    setBusy(false);
    setStatus(result ? LOCAL_COPY.exported(result.lines) : LOCAL_COPY.exportFailed);
  };
  return (
    <>
      <SectionHeader title={LOCAL_COPY.title} description={LOCAL_COPY.summary} />
      <Group>
        <Row anchor="privacy.viewData" description={status ?? LOCAL_COPY.viewDataDetail}>
          <Button title={LOCAL_COPY.viewData} disabled={busy} onPress={() => void save()} />
        </Row>
      </Group>
    </>
  );
}

function ResetIdSheet() {
  const [done, setDone] = useState<string | null>(null);
  const reset = async () => {
    const installId = await resetAnonymousId();
    setDone(identityFor(installId).name);
  };
  return (
    <Sheet size="s" onClose={closeSettingsSheet}>
      <DialogTitle subtitle={done ? IDENTITY_COPY.resetDone(done) : IDENTITY_COPY.resetBody}>{IDENTITY_COPY.resetTitle}</DialogTitle>
      <DialogActions>
        {done ? (
          <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
        ) : (
          <>
            <Button title="Cancel" onPress={closeSettingsSheet} />
            <Button title={IDENTITY_COPY.resetConfirm} kind="destructive" onPress={() => void reset()} />
          </>
        )}
      </DialogActions>
    </Sheet>
  );
}

export function WhatsSentSheet() {
  const groups = [...WHATS_SENT.slice(0, -1), { title: SHARING_COPY.keptOnThisMac, items: [...LOCAL_COPY.items] }, WHATS_SENT.at(-1)!];
  return (
    <Sheet size="l" onClose={closeSettingsSheet}>
      <DialogTitle subtitle={`Only while “${SHARING_COPY.toggle}” is on, except what’s under “Even with sharing off” and “Kept on this Mac”.`}>{SHARING_COPY.whatsSent}</DialogTitle>
      <ScrollView style={LIST}>
        {groups.map((group) => (
          <View key={group.title}>
            <SectionHeader title={group.title} />
            <Group>
              {group.items.map((item) => (
                <Row
                  key={item}
                  title={
                    <Text size="small" style={ITEM}>
                      {item}
                    </Text>
                  }
                />
              ))}
            </Group>
          </View>
        ))}
      </ScrollView>
      <DialogActions
        note={
          <Text size="caption" tone="textTertiary" style={FOOTNOTE}>
            {SHARING_COPY.footnote}
          </Text>
        }
      >
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </DialogActions>
    </Sheet>
  );
}

const LIST = { maxHeight: 420, marginTop: space.xs } as const;
const ITEM = { lineHeight: proseLineHeight.small } as const;
const FOOTNOTE = { lineHeight: lineHeight.caption } as const;
