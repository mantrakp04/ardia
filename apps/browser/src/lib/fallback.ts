import { isUnknownCall } from "@ardia/core";
import { errorText } from "./errors";

export const orWarn =
  <T,>(fallback: T) =>
  (error: unknown): T => {
    console.warn(`[engine] ${errorText(error)}`);
    return fallback;
  };

export const tolerateMissingCall = (error: unknown): void => {
  if (!isUnknownCall(error)) throw error;
  console.warn(`[engine] ${error.message}`);
};
