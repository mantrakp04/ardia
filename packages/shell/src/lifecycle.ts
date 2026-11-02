import type { EventSubscription } from "expo-modules-core";
import type { BangListReply } from "./documents";

export type AppEvent =
  | { type: "reopen" }
  | { type: "willQuit" }
  | { type: "quitCancelled" }
  | { type: "appearance"; dark: boolean }
  | { type: "quitWarningSuppressed" }
  | { type: "resignActive" }
  | { type: "screenLocked" }
  | { type: "lockedOrAsleep" }
  | { type: "switcherReleased" }
  | { type: "switcherKey"; key: "escape" | "next" | "previous" }
  | { type: "switcherMouseUp" }
  | { type: "dragEscape" };

export type AppearanceMode = "auto" | "light" | "dark";

type ShellEvents = {
  onAppEvent: (e: AppEvent) => void;
  onOpenURLs: (e: { urls: string[]; pointer?: [number, number] }) => void;
};

export type ShellNative = {
  addListener<K extends keyof ShellEvents>(name: K, listener: ShellEvents[K]): EventSubscription;
  setAppearance(mode: AppearanceMode): Promise<void>;
  isDarkAppearance(): Promise<boolean>;
  startDictation(): void;
  fetchBangList(etag: string | null): Promise<BangListReply>;
  copyText(text: string): void;
  readText(): Promise<string>;
};
