import { requireNativeModule } from "expo-modules-core";
import type { FollowKeyboard } from "./keyboardFollow";

export type { FollowKeyboard } from "./keyboardFollow";

export const followKeyboard: FollowKeyboard | null = (tabId) => requireNativeModule<{ followKeyboard: FollowKeyboard }>("ArdiaTabs").followKeyboard(tabId);
