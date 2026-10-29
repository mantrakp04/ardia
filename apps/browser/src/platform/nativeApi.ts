import { requireNativeModule, requireOptionalNativeModule } from "expo-modules-core";
import { DEV_EVAL_RESULT, watchDevEval } from "../lib/devEval";

export const NATIVE_API_VERSION = 35;

const built = requireOptionalNativeModule<{ apiVersion?: number }>("ArdiaApp")?.apiVersion ?? 0;

export const nativeApiSkew =
  built === NATIVE_API_VERSION
    ? null
    : `Native API skew: this JS bundle needs native API ${NATIVE_API_VERSION}, but the app was built with ` +
      `${built || "none (a build from before the check)"}. Rebuild the app from this checkout.`;

type Windows = { openWindow(id: string, options: { kind: string; title: string; focus: boolean }): Promise<void> };
type Documents = { readDocument(name: string): string | null; writeDocument(name: string, contents: string): void };

const skewedModule = <Module,>(name: string) => requireOptionalNativeModule<Module>(name) ?? requireNativeModule<Module>("ArdiaShell");

export function openSkewWindow() {
  void skewedModule<Windows>("ArdiaAppWindows").openWindow("native-api-skew", { kind: "settings", title: "Ardia", focus: false });
}

export function answerWithSkew(message: string) {
  const documents = skewedModule<Documents>("ArdiaDocuments");
  watchDevEval(documents.readDocument, 250, (id) => documents.writeDocument(DEV_EVAL_RESULT, JSON.stringify({ id, error: message })));
}
