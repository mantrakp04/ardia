import { requireNativeModule } from "expo-modules-core";
import type { LaunchLinksNative } from "@ardia/shell";

export const launchLinks = requireNativeModule<LaunchLinksNative>("ArdiaLaunchLinks");
