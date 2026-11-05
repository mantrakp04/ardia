import { ScrollView, View } from "react-native";
import { setSharing, useTelemetry } from "../../../state/telemetry/client";
import { SHARING_COPY, WHATS_SENT } from "../../../state/telemetry/copy";
import { Button, DialogActions, DialogTitle, lineHeight, proseLineHeight, Sheet, space, Text, Toggle } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";

export function ShareDiagnosticsSection() {
  const sharing = useTelemetry((s) => s.sharing);
  return (
    <>
      <SectionHeader title="Crash reports and usage" description={SHARING_COPY.dailyCountShort} />
      <Group>
        <Row anchor="privacy.shareDiagnostics" title={SHARING_COPY.toggle} description={SHARING_COPY.summary}>
          <Toggle value={sharing} onChange={(on) => setSharing(on, "settings")} />
        </Row>
        <Row anchor="privacy.whatsSent" title={SHARING_COPY.whatsSent} onPress={() => showSettingsSheet(<WhatsSentSheet />)} />
      </Group>
    </>
  );
}

export function WhatsSentSheet() {
  return (
    <Sheet size="l" onClose={closeSettingsSheet}>
      <DialogTitle subtitle={`Only while “${SHARING_COPY.toggle}” is on, except what’s under “Even with sharing off”.`}>{SHARING_COPY.whatsSent}</DialogTitle>
      <ScrollView style={LIST}>
        {WHATS_SENT.map((group) => (
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
