import { StyleSheet, Text, View } from "react-native";
import { PHONE_SHARING_COPY, PHONE_WHATS_SENT } from "../../lib/telemetryCopy";
import { popSettings } from "../../state/settings/nav";
import { font, settingsLayout, space, useTheme } from "../ui";
import { Divider, Group, SettingsPage } from "./SettingsKit";

export function WhatsSentPage() {
  const theme = useTheme();
  return (
    <SettingsPage title={PHONE_SHARING_COPY.whatsSent} onBack={popSettings}>
      {PHONE_WHATS_SENT.map((section, index) => (
        <Group key={section.title} header={section.title} footer={index === PHONE_WHATS_SENT.length - 1 ? PHONE_SHARING_COPY.footnote : null}>
          {section.items.map((item, at) => (
            <View key={item.text}>
              <Text style={[font.subheadline, styles.item, { color: theme.label }]}>{item.text}</Text>
              {at < section.items.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </Group>
      ))}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  item: { paddingHorizontal: settingsLayout.rowInset, paddingVertical: space.m },
});
