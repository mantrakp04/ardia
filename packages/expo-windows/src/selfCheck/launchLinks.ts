import { TurboModuleRegistry, type TurboModule } from "react-native";
import { addNativeListener, emitWhenListened } from "../events";
import { launchAddresses, type LaunchArguments } from "../launchLinks/addresses";
import { expectEqual, expectTrue, type Check } from "./check";

type WindowsHost = TurboModule & { launchArguments(): LaunchArguments };

const host = () => TurboModuleRegistry.getEnforcing<WindowsHost>("ArdiaWindowsHost");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const checks: Check[] = [
  {
    name: "ArdiaWindowsHost.launchArguments reads this launch's switches and no address",
    run() {
      const launch = host().launchArguments();
      expectTrue(Array.isArray(launch?.arguments), `arguments is ${JSON.stringify(launch?.arguments)}`);
      expectTrue(launch.arguments.every((argument) => typeof argument?.text === "string"), "an argument has no text");
      expectTrue(launch.arguments.some((argument) => argument.text === "--self-check"), `--self-check is not among ${JSON.stringify(launch.arguments.map((argument) => argument.text))}`);
      expectEqual(launch.single, undefined, "single argument");
      expectEqual(launchAddresses(launch), [], "addresses in the self-check launch");
    },
  },
  {
    name: "an event sent before anyone listens reaches the first listener once",
    async run() {
      const received: unknown[] = [];
      let delivered = 0;
      emitWhenListened("ArdiaSelfCheck", "held", { n: 1 }, () => delivered++);
      const subscription = addNativeListener("ArdiaSelfCheck", "held", (payload) => received.push(payload));
      try {
        await settled(50);
        const second = addNativeListener("ArdiaSelfCheck", "held", () => received.push("again"));
        await settled(50);
        second.remove();
        expectEqual(received, [{ n: 1 }], "events received");
        expectEqual(delivered, 1, "deliveries counted");
      } finally {
        subscription.remove();
      }
    },
  },
];
