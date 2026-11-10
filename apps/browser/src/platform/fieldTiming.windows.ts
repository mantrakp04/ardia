import type { FieldTiming } from "./fieldTiming";

export const fieldTiming: FieldTiming = {
  setEnabled() {},
  markFrame() {},
  lastInput: () => [0, 0],
  drain: () => [],
};
