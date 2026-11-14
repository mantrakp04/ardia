import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { IntroMusicModule } from "../nativeModuleTypes";
import { expectTrue, type Check } from "./check";

const RENDERED_SECONDS = 11.39;

export const checks: Check[] = [
  {
    name: "the intro music is embedded in the app and its calls answer in a silent background instance",
    run() {
      const native = TurboModuleRegistry.get<TurboModule & IntroMusicModule>("ArdiaIntroMusic");
      expectTrue(native, "ArdiaIntroMusic is not registered");
      const seconds = native.embeddedSeconds();
      expectTrue(Math.abs(seconds - RENDERED_SECONDS) < 0.05, `the embedded music lasts ${seconds} s`);
      native.play(false);
      native.setMuted(true);
      native.stop(0);
    },
  },
];
