export * from "../../browser/src/test-native/reactNative.ts";
export const unstable_batchedUpdates = (callback) => callback();
export const Pressable = () => null;
export const Text = () => null;
export const TextInput = () => null;
export const StyleSheet = { create: (styles) => styles, flatten: (style) => style, absoluteFill: {}, hairlineWidth: 1 };
export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
