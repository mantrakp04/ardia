import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { askForDefaultBrowser, refreshDefaultBrowser, useDefaultBrowser } from "../../state/settings/defaultBrowser";
import { popSettings } from "../../state/settings/nav";
import { defaultBrowserCopy } from "../../state/settings/settingsRules";
import { ArdiaLogo, capsule, font, radius, settingsLayout, settingsTint, space, Symbol, useTheme } from "../ui";
import { SettingsPage } from "./SettingsKit";

export function DefaultBrowserSteps({ onLater, onDone }: { onLater?: () => void; onDone?: () => void }) {
  const theme = useTheme();
  const status = useDefaultBrowser((s) => s.status);
  useEffect(() => {
    void refreshDefaultBrowser();
  }, []);
  if (!status) return null;
  const copy = defaultBrowserCopy(status);
  const ask = async () => {
    const after = await askForDefaultBrowser();
    if (after?.isDefault) onDone?.();
  };
  return (
    <View style={styles.column}>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={[font.largeTitle, styles.heavy, { color: theme.label }]}>
          {copy.title}
        </Text>
        <Text style={[font.body, styles.centered, { color: theme.secondaryLabel }]}>{copy.subtitle}</Text>
      </View>
      {copy.steps.length ? (
        <View style={[styles.card, { backgroundColor: theme.groupFill }]}>
          {copy.steps.map((step, index) => (
            <View key={step}>
              <View accessible style={styles.step}>
                {index === copy.steps.length - 1 ? (
                  <ArdiaLogo width={settingsLayout.tile} />
                ) : (
                  <View style={[styles.tile, { backgroundColor: settingsTint.sync }]}>
                    <Symbol name="arrowUpForward" size={16} color={theme.groupFill} />
                  </View>
                )}
                <Text style={[font.body, styles.fill, { color: theme.label }]}>{`${index + 1}. ${step}`}</Text>
              </View>
              {index < copy.steps.length - 1 ? <View style={[styles.divider, { backgroundColor: theme.separator }]} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        {copy.action ? (
          <Pressable accessibilityRole="button" onPress={() => void ask()} style={[styles.primary, { backgroundColor: theme.label }]}>
            <Text style={[font.body, styles.bold, { color: theme.groupFill }]}>{copy.action}</Text>
          </Pressable>
        ) : onLater ? (
          <Pressable accessibilityRole="button" onPress={onLater} style={[styles.primary, { backgroundColor: theme.label }]}>
            <Text style={[font.body, styles.bold, { color: theme.groupFill }]}>Continue</Text>
          </Pressable>
        ) : null}
        {copy.action && onLater ? (
          <Pressable accessibilityRole="button" onPress={onLater} style={styles.secondary}>
            <Text style={[font.body, styles.bold, { color: theme.label }]}>Maybe Later</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function DefaultBrowserPage() {
  return (
    <SettingsPage title="Default Browser" onBack={popSettings}>
      <DefaultBrowserSteps />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  column: { gap: space.xxl, paddingHorizontal: space.l + 4, paddingTop: space.l },
  words: { gap: space.s, alignItems: "center" },
  heavy: { fontWeight: "700", textAlign: "center" },
  centered: { textAlign: "center" },
  bold: { fontWeight: "600" },
  fill: { flex: 1 },
  card: { borderRadius: radius.card, overflow: "hidden" },
  step: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 52, paddingHorizontal: space.l },
  tile: { width: settingsLayout.tile, height: settingsLayout.tile, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
  actions: { gap: space.s },
  primary: { minHeight: settingsLayout.primaryButton, borderRadius: capsule(settingsLayout.primaryButton), alignItems: "center", justifyContent: "center" },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
});
