import { requireNativeModule } from "expo-modules-core";
import type { WindowControlsNative } from "@ardia/shell";
import type { WindowControls } from "./windowControls";

const Windows = requireNativeModule<WindowControlsNative>("ArdiaAppWindows");

export const windowControls: WindowControls = {
  minimize: (windowId) => void Windows.minimizeWindow(windowId),
  toggleMaximize: (windowId) => void Windows.toggleMaximizeWindow(windowId),
  setCaptionRegions: (windowId, regions) => void Windows.setCaptionRegions(windowId, regions),
};
