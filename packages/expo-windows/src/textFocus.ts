import type { FocusNative } from "@ardia/shell";
import type { TextInput } from "react-native";
import { requireNativeModule } from "./modules";

export type FocusOnWindows = FocusNative & { setTextInputFocused(focused: boolean): Promise<void>; textInputFocused(): boolean };

type SharedTextInputState = Pick<(typeof TextInput)["State"], "currentlyFocusedInput">;
type TextField = ReturnType<SharedTextInputState["currentlyFocusedInput"]> | null;
type TextInputState = SharedTextInputState & { focusInput(field: TextField): void; blurInput(field: TextField): void };

const textInputState: { default: TextInputState } = require("react-native/Libraries/Components/TextInput/TextInputState");

let installed = false;
let reported: boolean | undefined;

const focus = () => requireNativeModule<Pick<FocusOnWindows, "setTextInputFocused">>("ArdiaFocus");

export function reportTextInputFocus() {
  const focused = textInputState.default.currentlyFocusedInput() != null;
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
  const focusInput = state.focusInput.bind(state);
  const blurInput = state.blurInput.bind(state);
  state.focusInput = (field) => {
    focusInput(field);
    reportTextInputFocus();
  };
  state.blurInput = (field) => {
    blurInput(field);
    reportTextInputFocus();
  };
}

export const textFocusForCheck = {
  focused: () => textInputState.default.currentlyFocusedInput(),
  focus: (field: TextField) => textInputState.default.focusInput(field),
  blur: (field: TextField) => textInputState.default.blurInput(field),
};
