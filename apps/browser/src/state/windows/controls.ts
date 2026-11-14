import { windowControls, type CaptionRegion } from "../../platform/windowControls";
import { closeWindow } from "../../platform/windows";
import { useBrowser } from "../browser/store";
import { requestWindowClose } from "./windowClose";

export const minimizeWindow = (windowId: string) => windowControls.minimize(windowId);

export const toggleWindowMaximized = (windowId: string) => windowControls.toggleMaximize(windowId);

export function closeFromWindowControls(windowId: string) {
  if (useBrowser.getState().windows[windowId]) requestWindowClose(windowId);
  else void closeWindow(windowId);
}

export const markCaptionRegions = (windowId: string, regions: readonly CaptionRegion[]) => windowControls.setCaptionRegions(windowId, regions);
