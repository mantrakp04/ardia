import { APP_INGEST_KEY, INGEST_KEY_HEADER } from "@ardia/core/src/ingestKeys.ts";
import Constants from "expo-constants";
import { requireOptionalNativeModule, uuid } from "expo-modules-core";
import { Platform } from "react-native";
import { appVersionOf, osVersionOf, type DeviceFacts } from "../lib/telemetrySchema";

const LOGS_URL = "https://ardia.dev/otel/v1/logs";

export const JS_STARTED_AT = Date.now();

const isLab = process.env.EXPO_PUBLIC_ARDIA_LAB === "true";

export const newTelemetryId = () => uuid.v4().toLowerCase();

export const canPostTelemetry = () => !__DEV__;

export function deviceFacts(): DeviceFacts {
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion: appVersionOf(Constants.expoConfig?.version),
    osVersion: osVersionOf(Platform.Version),
    environment: __DEV__ ? "dev" : isLab ? "test" : "production",
  };
}

type ProcessClock = { processStartedAt?: () => number | Promise<number> };

const processClock = requireOptionalNativeModule<ProcessClock>("ArdiaPhoneSystem");

export async function processStartedAt(): Promise<number | null> {
  try {
    const at = await processClock?.processStartedAt?.();
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

export async function postTelemetry(body: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(LOGS_URL, { method: "POST", headers: { "Content-Type": "application/json", [INGEST_KEY_HEADER]: APP_INGEST_KEY }, body, signal });
  return response.status;
}
