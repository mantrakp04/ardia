import { Animated, Easing } from "react-native";
import type { MotionBurst, MotionNative } from "@ardia/shell";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const FADE_MS = 200;
const BURST_LIMIT_MS = 3000;

const motion = () => requireNativeModule<MotionNative>("ArdiaMotion");

export const checks: Check[] = [
  {
    name: "motion: an animation asked for the native driver runs in JS, lands on its end value and reports its frames",
    async run() {
      const value = new Animated.Value(0);
      const seen: number[] = [];
      const listening = value.addListener(({ value: at }) => void seen.push(at));
      let stop = () => {};
      const reported = new Promise<MotionBurst | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), BURST_LIMIT_MS);
        stop = motion().onBurst((burst) => {
          clearTimeout(timer);
          resolve(burst);
        });
      });
      const finished = await new Promise<boolean>((resolve) => {
        Animated.timing(value, { toValue: 1, duration: FADE_MS, easing: Easing.linear, useNativeDriver: true }).start((end) => resolve(end.finished));
      });
      const burst = await reported;
      stop();
      value.removeListener(listening);
      expectTrue(finished, "the animation did not finish");
      expectEqual((value as unknown as { __getValue(): number }).__getValue(), 1, "the value after the animation");
      expectTrue((value as unknown as { __isNative?: boolean }).__isNative !== true, "the value was handed to the native driver");
      expectTrue(seen.length >= 3, `the value's listener saw ${seen.length} steps, so the animation did not run frame by frame in JS`);
      expectTrue(
        seen.every((at, index) => index === 0 || at >= seen[index - 1]!),
        "the value did not rise steadily",
      );
      expectTrue(burst, `no burst of animation frames was reported within ${BURST_LIMIT_MS} ms`);
      expectTrue(burst.frames >= 3, `the burst had ${burst.frames} frames`);
      expectTrue(burst.milliseconds >= FADE_MS / 2, `the burst lasted ${burst.milliseconds} ms for a ${FADE_MS} ms animation`);
    },
  },
];
