import { requireNativeModule } from "../modules";
import { textFocusForCheck, type FocusOnWindows } from "../textFocus";
import { expectEqual, type Check } from "./check";

type TextField = Parameters<typeof textFocusForCheck.focus>[0];

const focus = () => requireNativeModule<Pick<FocusOnWindows, "textInputFocused">>("ArdiaFocus");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const standIn = (): TextField => JSON.parse("{}");

export const checks: Check[] = [
  {
    name: "a text field's focus reaches the Ctrl+Z check, and its blur clears it",
    async run() {
      const previous = textFocusForCheck.focused();
      const field = standIn();
      textFocusForCheck.focus(field);
      await settled(150);
      expectEqual(focus().textInputFocused(), true, "textInputFocused after a text field took focus");
      textFocusForCheck.blur(field);
      if (previous) textFocusForCheck.focus(previous);
      await settled(150);
      expectEqual(focus().textInputFocused(), previous != null, "textInputFocused after it lost focus");
    },
  },
];
