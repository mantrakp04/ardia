import { NativeModules } from "react-native";

export { copyText } from "@ardia/shell";

const NativeClipboard = NativeModules.Clipboard as { getString(): Promise<string> } | undefined;

export const readClipboard = (): Promise<string> => NativeClipboard?.getString().catch(() => "") ?? Promise.resolve("");
