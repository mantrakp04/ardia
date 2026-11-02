import { nativeModule, type Click, type ClickResult, type IntroMusicCues, type KeyPress, type KeyPressResult } from "@ardia/shell";

const Dev = nativeModule("ArdiaDev");

export const devCrash = (kind?: "exception") => Dev.devCrash(kind);
export const devRenderIntroMusic = (cues: IntroMusicCues, path: string) => Dev.devRenderIntroMusic(cues, path);
export const devRunAppleScript = (source: string) => Dev.devRunAppleScript(source);
export const devSnapshotWindow = (windowId: string, path: string, transparent = false) => Dev.devSnapshotWindow(windowId, path, transparent);
export const devSetPointer = (windowId: string, point: { x: number; y: number } | null): Promise<boolean> =>
  Dev.devSetPointer(windowId, point?.x ?? 0, point?.y ?? 0, !!point).then((placed: boolean) => {
    if (!placed && point) throw new Error(`devSetPointer placed nothing: no window ${windowId} (ids are the store's windowOrder), or a build without the pointer override`);
    return placed;
  });
export const devSetMouseButtons = (pressed: boolean | null) => Dev.devSetMouseButtons(pressed === null ? -1 : pressed ? 1 : 0);
export const devHoverStats = (reset = true) => Dev.devHoverStats(reset);
export const devLeftEdgePointer = (windowId: string, point: { x: number; y: number } | null) =>
  Dev.devLeftEdgePointer(windowId, point?.x ?? 0, point?.y ?? 0, !!point);
export const devLeftEdgeStats = (reset = false) => Dev.devLeftEdgeStats(reset);
export const devTypeKeys = (windowId: string, text: string, interval: number) => Dev.devTypeKeys(windowId, text, interval);
export const devKeyEquivalent = (windowId: string, press: KeyPress): Promise<KeyPressResult> => Dev.devKeyEquivalent(windowId, press);
export const devClick = (windowId: string, click: Click): Promise<ClickResult> => Dev.devClick(windowId, click);
export const devMenuCommand = (command: string, arg: string | null = null) => Dev.devMenuCommand(command, arg);
