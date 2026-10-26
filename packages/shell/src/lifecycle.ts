import { Shell } from "./shellNative";

export type AppEvent =
  | { type: "reopen" }
  | { type: "willQuit" }
  | { type: "quitCancelled" }
  | { type: "appearance"; dark: boolean }
  | { type: "quitWarningSuppressed" }
  | { type: "resignActive" }
  | { type: "screenLocked" }
  | { type: "switcherReleased" }
  | { type: "switcherKey"; key: "escape" | "next" | "previous" }
  | { type: "switcherMouseUp" }
  | { type: "dragEscape" };

export const setAppearance = (mode: "auto" | "light" | "dark") => Shell.setAppearance(mode);
export const isDarkAppearance = () => Shell.isDarkAppearance();

export const replyToTerminate = (ok: boolean) => Shell.replyToTerminate(ok);

export const onAppEvent = (listener: (e: AppEvent) => void) => Shell.addListener("onAppEvent", listener);
export const onOpenURLs = (listener: (urls: string[], pointer?: [number, number]) => void) =>
  Shell.addListener("onOpenURLs", ({ urls, pointer }) => listener(urls, pointer));
