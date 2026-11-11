import { TurboModuleRegistry, type TurboModule } from "react-native";
import { expectEqual, expectTrue, type Check } from "./check";

type EngineHost = TurboModule & {
  available(): boolean;
  hostCall(verb: string, argsJson: string, windowId: string): Promise<string>;
  engineCall(name: string, profileDir: string, argsJson: string): Promise<string>;
};

const engineHost = () => {
  const found = TurboModuleRegistry.get<EngineHost>("ArdiaEngineHost");
  expectTrue(found, "ArdiaEngineHost has no native module");
  return found;
};

const expectNoEngine = (reply: unknown, what: string) => {
  expectEqual(typeof reply, "string", `the type of ${what}'s reply`);
  expectTrue(String(reply).includes("no engine"), `${what} answered ${JSON.stringify(reply)}`);
};

export const checks: Check[] = [
  {
    name: "engine host: a standalone launch has no engine",
    run() {
      expectEqual(engineHost().available(), false, "available()");
    },
  },
  {
    name: "engine host: a host call with no engine answers that there is none",
    async run() {
      expectNoEngine(await engineHost().hostCall("ping", "{}", ""), "hostCall");
    },
  },
  {
    name: "engine host: an engine call with no engine answers that there is none",
    async run() {
      expectNoEngine(await engineHost().engineCall("ping", "", "{}"), "engineCall");
    },
  },
];
