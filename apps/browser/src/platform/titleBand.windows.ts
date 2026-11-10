import { requireNativeModule } from "expo-modules-core";
import type { TitleBand, TitleBands } from "./titleBand";

type TitleBandNative = { setTitleBand(windowId: string, mode: TitleBand): Promise<void> };

const Windows = requireNativeModule<TitleBandNative>("ArdiaAppWindows");

export const titleBands: TitleBands = {
  set: (windowId, mode) => void Windows.setTitleBand(windowId, mode),
};
