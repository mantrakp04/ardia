import type { IntroMusicCues } from "./app";

export type LeftEdgeStats = { wakes?: { global: number; local: number }; global?: boolean; local?: boolean; watched?: number };
export type KeyTiming = { due: number; handled: number; drawn: number };
export type KeyPress = {
  key: string;
  keyCode: number;
  modifiers?: ("command" | "shift" | "option" | "control" | "function")[];
  characters?: string;
  focus?: "window" | "page" | "devtools" | `label:${string}`;
  repeats?: number;
  repeatEvery?: number;
  asKey?: boolean;
  settle?: number;
  wait?: number;
  dry?: boolean;
  send?: boolean;
};
export type KeyPressResult = {
  handledBy?: "page" | "window" | "menu" | "none";
  firstResponder?: string;
  fired?: { title: string; action: string; command?: string; arg?: string; dry?: boolean }[];
  matched?: { title: string; action: string; command?: string; arg?: string; enabled: boolean }[];
  error?: string;
};
export type Click = { x: number; y: number; in?: "window" | "page"; label?: string; queued?: boolean; asKey?: boolean; wait?: number };
export type ClickResult = { hit?: string; at?: number; firstResponder?: string; firstResponderOnClick?: string; firstResponderAfter?: string; error?: string };

export type DevNative = {
  devCrash(kind?: "exception"): Promise<void>;
  devRenderIntroMusic(cues: IntroMusicCues, path: string): Promise<number | null>;
  devRunAppleScript(source: string): Promise<{ ok: boolean; result?: unknown; error?: string; number?: number }>;
  devSnapshotWindow(windowId: string, path: string, transparent?: boolean): Promise<boolean>;
  devSetPointer(windowId: string, x: number, y: number, on: boolean): Promise<boolean>;
  devSetMouseButtons(pressed: number): Promise<boolean>;
  devLeftEdgePointer(windowId: string, x: number, y: number, on: boolean): Promise<boolean>;
  devLeftEdgeStats(reset: boolean): Promise<LeftEdgeStats>;
  devHoverStats(reset: boolean): Promise<{ passes?: number; log?: [string, number, number][]; registered?: number }>;
  devMenuCommand(command: string, arg: string | null): Promise<void>;
  devTypeKeys(windowId: string, text: string, interval: number): Promise<KeyTiming[]>;
  devKeyEquivalent(windowId: string, press: KeyPress): Promise<KeyPressResult>;
  devClick(windowId: string, click: Click): Promise<ClickResult>;
  devShortcutRecording(): Promise<boolean>;
  devReceiveURLsWhenDetached(urls: string[], timeoutMs: number): void;
  devURLDelivery(): Promise<{ state?: "waiting" | "received" | "neverDetached"; waitedMs?: number; attachedAfter?: boolean }>;
};
