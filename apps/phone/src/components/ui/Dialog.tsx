import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { tabsMotion } from "./motion";
import { useTheme } from "./theme";
import { dialogLayout, font, space } from "./tokens";

export type DialogButton = { title: string; onPress: () => void; destructive?: boolean };

type Props = { title: string; message?: string | null; buttons: DialogButton[]; onDismiss: () => void; children?: ReactNode };

export function Dialog({ title, message, buttons, onDismiss, children }: Props) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(tabsMotion.surfaceFade)} exiting={FadeOut.duration(tabsMotion.surfaceFade)} style={StyleSheet.absoluteFill}>
      <Pressable accessibilityLabel="Dismiss" style={[StyleSheet.absoluteFill, { backgroundColor: theme.dialogScrim }]} onPress={onDismiss} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center} pointerEvents="box-none">
        <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: theme.panel, shadowColor: theme.trayShadow }]}>
          <Text accessibilityRole="header" style={[font.title3, styles.title, { color: theme.label }]}>
            {title}
          </Text>
          {message ? <Text style={[font.body, { color: theme.secondaryLabel }]}>{message}</Text> : null}
          {children}
          <View style={styles.buttons}>
            {buttons.map((button) => (
              <Pressable key={button.title} accessibilityRole="button" onPress={button.onPress} style={styles.button}>
                <Text style={[font.body, styles.buttonText, { color: button.destructive ? theme.destructive : theme.formAccent }]}>{button.title}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  panel: { width: dialogLayout.width, borderRadius: dialogLayout.radius, padding: space.xxl, gap: space.l, elevation: 24 },
  title: { fontWeight: "600" },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: space.s },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.m },
  buttonText: { fontWeight: "600" },
});
