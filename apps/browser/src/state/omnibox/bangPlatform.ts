export const refreshesBangs = true;

export const loadBundledBangs = (): Promise<typeof import("@ardia/core/src/bangList.ts")> =>
  Promise.resolve().then(() => require("@ardia/core/src/bangList.ts"));
