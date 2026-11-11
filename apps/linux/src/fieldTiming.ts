import type { fieldTiming as sharedFieldTiming } from "../../browser/src/platform/fieldTiming";

export const fieldTiming: typeof sharedFieldTiming = {
  setEnabled: () => {},
  markFrame: () => {},
  lastInput: () => [0, 0],
  drain: () => [],
};
