import { Animated as sharedAnimated } from "../../browser/src/test-native/reactNative.ts";

export * from "../../browser/src/test-native/reactNative.ts";
export const unstable_batchedUpdates = (update) => update();
export const Animated = {
  ...sharedAnimated,
  Value: class {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
  },
};
export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
