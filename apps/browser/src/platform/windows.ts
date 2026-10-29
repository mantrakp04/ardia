export {
  openWindow,
  closeWindow,
  focusWindow,
  animateWindowClose,
  restoreFullScreen,
  setWindowTitle,
  setTrafficLightsCenter,
  watchSidebarEdge,
  raiseView,
  windowFrame,
  windowIds,
  onWindowEvent,
  dragPreview,
  type DragPreviewShape,
  type WindowEvent,
  type OpenWindowOptions,
} from "@ardia/shell";
import { call } from "@ardia/ardiacore";
import { nativeModule } from "@ardia/shell";

export const chromeWindows = () => call("windows.list");
export const devWindowAction = (windowNumber: number, action: string) => call("windows.dev", { window: windowNumber, action });

export const setWindowActivity = (windowId: string, url: string | null, title: string | null) =>
  nativeModule("ArdiaApp").setWindowActivity(windowId, url, title);
