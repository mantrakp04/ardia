import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "../../state/browse/hooks";
import { retryPage, retryWhenOnline } from "../../state/page/actions";
import { failureIcon, retriesWhenOnline, type FailureIcon } from "../../state/page/pageFailure";
import { capsule, failureLayout, font, space, Symbol, useTheme, type SymbolName } from "../ui";

const ICONS: Record<FailureIcon, SymbolName> = { crashed: "exclamationmarkTriangle", offline: "wifiSlash", network: "globe" };

export function PageFailureView({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const failure = useNavigation(tabId, (n) => n?.failure ?? null);
  const waitsForNetwork = failure ? retriesWhenOnline(failure) : false;
  useEffect(() => (waitsForNetwork ? retryWhenOnline(tabId) : undefined), [waitsForNetwork, tabId]);
  if (!failure) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.column, { backgroundColor: theme.surface }]}>
      <View style={styles.icon}>
        <Symbol name={ICONS[failureIcon(failure)]} size={failureLayout.icon} color={theme.secondaryLabel} />
      </View>
      <Text accessibilityRole="header" style={[font.title3, styles.bold, styles.text, { color: theme.label }]}>
        {failure.title}
      </Text>
      <Text style={[font.subheadline, styles.text, { color: theme.secondaryLabel }]}>{failure.message}</Text>
      <Pressable accessibilityRole="button" onPress={() => retryPage(tabId)} style={[styles.retry, { borderColor: theme.separator }]}>
        <Text style={[font.body, { color: theme.formAccent }]}>Try Again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: "center", justifyContent: "center", gap: space.s, paddingHorizontal: space.huge },
  icon: { paddingBottom: space.xs },
  bold: { fontWeight: "600" },
  text: { textAlign: "center", maxWidth: failureLayout.textWidth },
  retry: {
    marginTop: space.m,
    minHeight: failureLayout.button,
    paddingHorizontal: space.xxl,
    borderRadius: capsule(failureLayout.button),
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
});
