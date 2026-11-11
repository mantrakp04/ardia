import type { ShellNativeModules } from "@ardia/shell";
import { TurboModuleRegistry } from "react-native";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type Focus = ShellNativeModules["ArdiaFocus"];

const focus = () => requireNativeModule<Focus>("ArdiaFocus");

export const checks: Check[] = [
  {
    name: "focus: the Escape and tab switcher captures are native",
    run() {
      expectTrue(TurboModuleRegistry.get("ArdiaFocus"), "ArdiaFocus has no native module");
    },
  },
  {
    name: "focus: the Escape capture turns on and off",
    async run() {
      await focus().setDragEscapeCapture(true);
      await focus().setDragEscapeCapture(true);
      await focus().setDragEscapeCapture(false);
      await focus().setDragEscapeCapture(false);
    },
  },
  {
    name: "focus: the tab switcher capture turns on and off and reports whether the pointer moved",
    async run() {
      await focus().setSwitcherCapture(true);
      try {
        expectEqual(typeof focus().switcherPointerMoved(), "boolean", "switcherPointerMoved while the switcher is open");
      } finally {
        await focus().setSwitcherCapture(false);
      }
      expectEqual(focus().switcherPointerMoved(), true, "switcherPointerMoved with no switcher open");
    },
  },
];
