import type { EventSubscription } from "expo-modules-core";

export type ConfigFileRead =
  | { status: "ok"; text: string; stamp?: string }
  | { status: "missing" | "notFile" | "tooBig" | "unreadable"; text?: undefined; stamp?: string };

export type ConfigNative = {
  readFile(name: string): ConfigFileRead;
  watch(names: string[]): Promise<void>;
  writeSchemas(files: Record<string, string>): Promise<string[]>;
  addListener(name: "onChange", listener: () => void): EventSubscription;
};
