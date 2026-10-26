import { Shell } from "./shellNative";
import type { Rect4 } from "./shellNative";

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
  pointer?: [number, number];
  animated?: boolean;
};

export const openWindow = (id: string, options: OpenWindowOptions = {}) => Shell.openWindow(id, options);

export const closeWindow = (id: string) => Shell.closeWindow(id);
export const animateWindowClose = (id: string, after: string | null = null) => Shell.animateWindowClose(id, after);
export const restoreFullScreen = (ids: string[], focus: string | null) => Shell.restoreFullScreen(ids, focus);
export const focusWindow = (id: string) => Shell.focusWindow(id);
export const setWindowTitle = (id: string, title: string) => Shell.setWindowTitle(id, title);
export const setTrafficLightsCenter = (id: string, center: [number, number] | null) =>
  Shell.setTrafficLightsCenter(id, center);
export const watchLeftEdge = (id: string, on: boolean, hold = 0) => void Shell.watchLeftEdge(id, on, hold);

export type DragPreviewShape = "hidden" | "pill" | "card";
export const dragPreview = {
  begin: (windowId: string, chip: Rect4, grab: [number, number]) => void Shell.dragPreviewBegin(windowId, chip, grab),
  page: (base64: string, frame: Rect4) => void Shell.dragPreviewPage(base64, frame),
  update: (shape: DragPreviewShape, point: [number, number]) => void Shell.dragPreviewUpdate(shape, point),
  end: (windowId: string | null = null, frame: Rect4 | null = null) => void Shell.dragPreviewEnd(windowId, frame),
  cancel: () => void Shell.dragPreviewCancel(),
  placeholder: (title: string, favicon: string | null) => void Shell.dragPreviewPlaceholder(title, favicon),
};
export const raiseView = (tag: number | null, levels: number, raised: boolean) => {
  if (tag != null) void Shell.raiseView(tag, levels, raised);
};
export const windowFrame = (id: string): Promise<Rect4 | null> => Shell.windowFrame(id);
export const windowIds = () => Shell.windowIds();

export const onWindowEvent = (listener: (e: WindowEvent) => void) => Shell.addListener("onWindowEvent", listener);
