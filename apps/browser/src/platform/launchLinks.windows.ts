import { requireNativeModule } from "expo-modules-core";
import type { LaunchLinks } from "./launchLinks";

export const launchLinks = requireNativeModule<LaunchLinks>("ArdiaLaunchLinks");
