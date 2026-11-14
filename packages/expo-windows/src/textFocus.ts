import type { FocusNative } from "@ardia/shell";
import type { TextInput } from "react-native";
import { noteFieldAsked, notePagePressed, placeOfField, readFocusedFieldWith, takeKeyboardFor, windowIdOfField } from "./appKeyboard";
import { engineAvailable, hostCall } from "./engine/host";
import { onPagePress } from "./engine/pages";
import { requireNativeModule } from "./modules";

export type FocusOnWindows = FocusNative & { setTextInputFocused(focused: boolean): Promise<void>; textInputFocused(): boolean; takeKeyboardFromPage(windowId: string): Promise<boolean> };

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
const FOCUSING: ReadonlySet<Reported> = new Set(["focusInput", "focusTextInput"]);

const textInputState: { default: TextInputState } = require("react-native/Libraries/Components/TextInput/TextInputState");

let installed = false;
let reported: boolean | undefined;

const focus = () => requireNativeModule<Pick<FocusOnWindows, "setTextInputFocused" | "takeKeyboardFromPage">>("ArdiaFocus");

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
  readFocusedFieldWith(() => {
    const field = state.currentlyFocusedInput();
    return field != null && state.isTextInput(field) ? { field, ...placeOfField(field) } : null;
  });
  onPagePress((windowId) => notePagePressed(windowId));
  for (const name of REPORTED) {
    const original = state[name].bind(state);
    state[name] = (field: TextField) => {
      original(field);
      reportTextInputFocus();
      if (FOCUSING.has(name) && field != null) fieldAskedForKeyboard(windowIdOfField(field));
    };
  }
}

function fieldAskedForKeyboard(windowId: string) {
  noteFieldAsked(windowId);
  if (windowId && engineAvailable()) void hostCall("keyboard.forget", {}, windowId).catch(() => {});
  void takeKeyboardFor(focus(), windowId);
}

export const textFocusForCheck = {
  focused: () => textInputState.default.currentlyFocusedInput(),
  register: (field: TextField) => textInputState.default.registerInput(field),
  unregister: (field: TextField) => textInputState.default.unregisterInput(field),
  focus: (field: TextField) => textInputState.default.focusInput(field),
  blur: (field: TextField) => textInputState.default.blurInput(field),
};
