import { requireNativeModule } from "expo-modules-core";
import type { CaptionRegion, WindowControls } from "./windowControls";

type WindowControlsNative = {
  minimizeWindow(windowId: string): Promise<void>;
  toggleMaximizeWindow(windowId: string): Promise<void>;
  setCaptionRegions(windowId: string, regions: readonly CaptionRegion[]): Promise<void>;
};

const Windows = requireNativeModule<WindowControlsNative>("ArdiaAppWindows");

export const windowControls: WindowControls = {
  minimize: (windowId) => void Windows.minimizeWindow(windowId),
  toggleMaximize: (windowId) => void Windows.toggleMaximizeWindow(windowId),
  setCaptionRegions: (windowId, regions) => void Windows.setCaptionRegions(windowId, regions),
};
