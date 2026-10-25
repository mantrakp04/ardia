import { requireNativeModule, requireOptionalNativeModule } from "expo-modules-core";
import { AppRegistry, Text, View } from "react-native";

export const NATIVE_API_VERSION = 19;

const built = requireOptionalNativeModule<{ apiVersion?: number }>("ArdiaApp")?.apiVersion ?? 0;

export const nativeApiSkew =
  built === NATIVE_API_VERSION
    ? null
    : `Native API skew: this JS bundle needs native API ${NATIVE_API_VERSION}, but the app was built with ` +
      `${built || "none (a build from before the check)"}. Rebuild the app from this checkout.`;

type Shell = {
  openWindow(id: string, options: { kind: string; title: string; focus: boolean }): Promise<void>;
  readDocument(name: string): string | null;
  writeDocument(name: string, contents: string): void;
};

export function startSkewed(message: string) {
  console.error(`[ardia] ${message}`);
  AppRegistry.registerComponent("main", () => () => (
    <View style={{ flex: 1, backgroundColor: "#1b1416", padding: 24, paddingTop: 48 }}>
      <Text selectable style={{ color: "#ff8a8a", fontSize: 14, fontFamily: "Menlo" }}>
        {message}
      </Text>
    </View>
  ));
  void requireNativeModule<Shell>("ArdiaShell").openWindow("native-api-skew", { kind: "settings", title: "Ardia", focus: false });
  if (__DEV__) answerWithSkew(message, "dev-eval.js", "dev-eval-result.json");
}

export function answerWithSkew(message: string, command: string, result: string) {
  const shell = requireNativeModule<Shell>("ArdiaShell");
  const idOf = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = idOf(shell.readDocument(command)) ?? "";
  setInterval(() => {
    const id = idOf(shell.readDocument(command));
    if (!id || id === lastId) return;
    lastId = id;
    shell.writeDocument(result, JSON.stringify({ id, error: message }));
  }, 250);
}
