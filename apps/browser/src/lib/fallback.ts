export const orWarn =
  <T,>(fallback: T) =>
  (error: unknown): T => {
    console.warn(`[engine] ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  };
