import { ScrollView, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { setSharing, useTelemetry } from "../../../state/telemetry/client";
import { SHARING_COPY, WHATS_SENT } from "../../../state/telemetry/copy";
import { Button, font, Sheet, Toggle } from "../../ui";
import { Group, Row, SectionHeader, SheetTitle } from "../Form";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { settingsType } from "../tokens";

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
  const theme = useTheme();
  return (
    <Sheet width={500} onClose={closeSettingsSheet}>
      <SheetTitle>{SHARING_COPY.whatsSent}</SheetTitle>
      <Text style={{ ...font.small, marginTop: 4, color: theme.textSecondary, lineHeight: 16 }}>
        Only while “{SHARING_COPY.toggle}” is on, except what’s under “Even with sharing off”.
      </Text>
      <ScrollView style={{ maxHeight: 420, marginTop: 4 }}>
        {WHATS_SENT.map((group) => (
          <View key={group.title}>
            <SectionHeader title={group.title} />
            <Group>
              {group.items.map((item) => (
                <Row key={item} title={<Text style={{ ...settingsType.lead, lineHeight: 17, color: theme.textPrimary }}>{item}</Text>} />
              ))}
            </Group>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Text style={{ flex: 1, ...font.footnote, lineHeight: 15, color: theme.textTertiary }}>{SHARING_COPY.footnote}</Text>
        <Button title="Done" kind="primary" onPress={closeSettingsSheet} />
      </View>
    </Sheet>
  );
}
