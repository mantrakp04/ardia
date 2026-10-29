import { call } from "@ardia/ardiacore";
import { nativeModule, type DragPreviewShape, type OpenWindowOptions, type Rect4, type WindowEvent } from "@ardia/shell";

export type { DragPreviewShape, WindowEvent, OpenWindowOptions };

const Windows = nativeModule("ArdiaAppWindows");

export const openWindow = (id: string, options: OpenWindowOptions = {}) => Windows.openWindow(id, options);
export const closeWindow = (id: string) => Windows.closeWindow(id);
export const animateWindowClose = (id: string, after: string | null = null) => Windows.animateWindowClose(id, after);
export const restoreFullScreen = (ids: string[], focus: string | null) => Windows.restoreFullScreen(ids, focus);
export const focusWindow = (id: string) => Windows.focusWindow(id);
export const setWindowTitle = (id: string, title: string) => Windows.setWindowTitle(id, title);
export const setTrafficLightsCenter = (id: string, center: [number, number] | null) => Windows.setTrafficLightsCenter(id, center);
export const watchLeftEdge = (id: string, on: boolean, hold = 0) => void Windows.watchLeftEdge(id, on, hold);
export const windowFrame = (id: string) => Windows.windowFrame(id);
export const windowIds = () => Windows.windowIds();
export const onWindowEvent = (listener: (e: WindowEvent) => void) => Windows.addListener("onWindowEvent", listener);
export const replyToTerminate = (ok: boolean) => Windows.replyToTerminate(ok);
export const raiseView = (tag: number | null, levels: number, raised: boolean) => {
  if (tag != null) void Windows.raiseView(tag, levels, raised);
};
export const dragPreview = {
  begin: (windowId: string, chip: Rect4, grab: [number, number]) => void Windows.dragPreviewBegin(windowId, chip, grab),
  page: (base64: string, frame: Rect4) => void Windows.dragPreviewPage(base64, frame),
  update: (shape: DragPreviewShape, point: [number, number]) => void Windows.dragPreviewUpdate(shape, point),
  end: (windowId: string | null = null, frame: Rect4 | null = null) => void Windows.dragPreviewEnd(windowId, frame),
  cancel: () => void Windows.dragPreviewCancel(),
  placeholder: (title: string, favicon: string | null) => void Windows.dragPreviewPlaceholder(title, favicon),
};

export const chromeWindows = () => call("windows.list");
export const devWindowAction = (windowNumber: number, action: string) => call("windows.dev", { window: windowNumber, action });

export const setWindowActivity = (windowId: string, url: string | null, title: string | null) =>
  nativeModule("ArdiaApp").setWindowActivity(windowId, url, title);
