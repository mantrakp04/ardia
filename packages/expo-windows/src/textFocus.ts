import type { FocusNative } from "@ardia/shell";
import type { TextInput } from "react-native";
import { requireNativeModule } from "./modules";

export type FocusOnWindows = FocusNative & { setTextInputFocused(focused: boolean): Promise<void>; textInputFocused(): boolean };

type SharedTextInputState = Pick<(typeof TextInput)["State"], "currentlyFocusedInput" | "focusTextInput" | "blurTextInput">;
type TextField = Parameters<SharedTextInputState["focusTextInput"]>[0];
type TextInputState = SharedTextInputState & {
  focusInput(field: TextField): void;
  blurInput(field: TextField): void;
  registerInput(field: TextField): void;
  unregisterInput(field: TextField): void;
  isTextInput(field: TextField): boolean;
};
type Reported = "focusInput" | "blurInput" | "focusTextInput" | "blurTextInput" | "registerInput" | "unregisterInput";

const REPORTED: readonly Reported[] = ["focusInput", "blurInput", "focusTextInput", "blurTextInput", "registerInput", "unregisterInput"];

const textInputState: { default: TextInputState } = require("react-native/Libraries/Components/TextInput/TextInputState");

let installed = false;
let reported: boolean | undefined;

const focus = () => requireNativeModule<Pick<FocusOnWindows, "setTextInputFocused">>("ArdiaFocus");

export function textInputHasFocus(state: Pick<TextInputState, "currentlyFocusedInput" | "isTextInput"> = textInputState.default): boolean {
  const field = state.currentlyFocusedInput();
  return field != null && state.isTextInput(field);
}

export function reportTextInputFocus() {
  const focused = textInputHasFocus();
  if (focused === reported) return;
  reported = focused;
  void Promise.resolve(focus().setTextInputFocused(focused)).catch(() => {
    reported = undefined;
  });
}

export function installTextFocusReport() {
  if (installed) return;
  installed = true;
  const state = textInputState.default;
  for (const name of REPORTED) {
    const original = state[name].bind(state);
    state[name] = (field: TextField) => {
      original(field);
      reportTextInputFocus();
    };
  }
}

export const textFocusForCheck = {
  focused: () => textInputState.default.currentlyFocusedInput(),
  register: (field: TextField) => textInputState.default.registerInput(field),
  unregister: (field: TextField) => textInputState.default.unregisterInput(field),
  focus: (field: TextField) => textInputState.default.focusInput(field),
  blur: (field: TextField) => textInputState.default.blurInput(field),
};
