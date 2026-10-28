import { requireNativeModule, requireOptionalNativeModule } from "expo-modules-core";

export const NATIVE_API_VERSION = 22;

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

export function openSkewWindow() {
  void requireNativeModule<Shell>("ArdiaShell").openWindow("native-api-skew", { kind: "settings", title: "Ardia", focus: false });
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
