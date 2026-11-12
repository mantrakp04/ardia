import { requireNativeModule } from "expo-modules-core";
import type { AnimationBursts } from "./motion";

export const animationBursts = requireNativeModule<AnimationBursts>("ArdiaMotion");
