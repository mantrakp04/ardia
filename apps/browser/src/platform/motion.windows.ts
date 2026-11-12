import { requireNativeModule } from "expo-modules-core";
import type { MotionNative } from "@ardia/shell";

export const animationBursts = requireNativeModule<MotionNative>("ArdiaMotion");
