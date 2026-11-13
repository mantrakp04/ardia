import type { AppNative } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { IntroMusicModule } from "./nativeModuleTypes";

const native = () => TurboModuleRegistry.get<TurboModule & IntroMusicModule>("ArdiaIntroMusic");

export const windowsIntroMusic: Pick<AppNative, "playIntroMusic" | "setIntroMusicMuted" | "stopIntroMusic"> = {
  playIntroMusic: async (_cues, muted) => native()?.play(muted),
  setIntroMusicMuted: async (muted) => native()?.setMuted(muted),
  stopIntroMusic: async (fade) => native()?.stop(fade),
};
