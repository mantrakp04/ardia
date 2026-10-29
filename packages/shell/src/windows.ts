import type { EventSubscription } from "expo-modules-core";

export type Rect4 = [number, number, number, number];

export type WindowEvent =
  | { type: "focus"; id: string }
  | { type: "close"; id: string }
  | { type: "frame"; id: string; frame: [number, number, number, number] }
  | { type: "fullScreen"; id: string; on: boolean }
  | { type: "leftEdge"; id: string; over: boolean; point: [number, number] }
  | { type: "closeRequest"; id: string };

export type OpenWindowOptions = {
  frame?: [number, number, number, number] | null;
  incognito?: boolean;
  title?: string;
  focus?: boolean;
  kind?: "browser" | "small" | "settings" | "import";
  profile?: string;
  size?: [number, number];
  behind?: string;
  chromeWindow?: string;
  claim?: string;
  pointer?: [number, number];
  animated?: boolean;
};

export type DragPreviewShape = "hidden" | "pill" | "card";

export type WindowsNative = {
  addListener(name: "onWindowEvent", listener: (e: WindowEvent) => void): EventSubscription;
  openWindow(id: string, options: OpenWindowOptions): Promise<void>;
  closeWindow(id: string): Promise<void>;
  animateWindowClose(id: string, after: string | null): Promise<void>;
  focusWindow(id: string): Promise<void>;
  restoreFullScreen(ids: string[], focus: string | null): Promise<void>;
  setTrafficLightsCenter(id: string, center: [number, number] | null): Promise<void>;
  watchLeftEdge(id: string, on: boolean, hold: number): Promise<void>;
  dragPreviewBegin(windowId: string, chip: Rect4, grab: [number, number]): Promise<void>;
  dragPreviewPage(base64: string, frame: Rect4): Promise<void>;
  dragPreviewUpdate(shape: DragPreviewShape, point: [number, number]): Promise<void>;
  dragPreviewCancel(): Promise<void>;
  dragPreviewPlaceholder(title: string, favicon: string | null): Promise<void>;
  dragPreviewEnd(windowId: string | null, frame: Rect4 | null): Promise<void>;
  raiseView(tag: number, levels: number, raised: boolean): Promise<void>;
  windowFrame(id: string): Promise<Rect4 | null>;
  setWindowTitle(id: string, title: string): Promise<void>;
  windowIds(): Promise<string[]>;
  replyToTerminate(ok: boolean): Promise<void>;
};
