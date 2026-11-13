import { requireNativeModule } from "expo-modules-core";
import type { ExternalAppCountsNative } from "@ardia/shell";

export const externalAppCounts = requireNativeModule<ExternalAppCountsNative>("ArdiaExternalAppCounts");
