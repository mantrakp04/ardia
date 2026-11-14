import { requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

export const ClipView = requireNativeViewManager<ViewProps>("ArdiaClipView");
