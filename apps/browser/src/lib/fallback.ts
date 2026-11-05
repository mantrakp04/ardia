import { errorText } from "./errors";

export const orWarn =
  <T,>(fallback: T) =>
  (error: unknown): T => {
    console.warn(`[engine] ${errorText(error)}`);
    return fallback;
  };
