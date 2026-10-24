import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

globalThis.__DEV__ = false;
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/lib/cliControl.ts") || specifier !== "../components/pages") return next(specifier, context);
    const stub = "export const isInternalTab = () => false;";
    return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
  },
});
mock.timers.enable({ apis: ["setTimeout"] });
const { cliDisclosure, useCli } = await import("./cliControl.ts");
const { CLI_DISCLOSURE_HOLD_MS } = await import("./cliDisclosure.ts");

test("the app's one disclosure store is fed by useCli, so every pill reads the same hold", () => {
  assert.equal(cliDisclosure.getState().shown, false);
  useCli.setState({ server: { state: "on", connections: 1 } });
  assert.equal(cliDisclosure.getState().shown, true);
  useCli.setState({ server: { state: "on", connections: 0 } });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS / 2);
  const late = [];
  const unsubscribe = cliDisclosure.subscribe((s) => late.push(s.shown));
  assert.equal(cliDisclosure.getState().shown, true);
  useCli.setState({ server: { state: "on", connections: 1 } });
  mock.timers.tick(CLI_DISCLOSURE_HOLD_MS * 2);
  assert.equal(cliDisclosure.getState().shown, true);
  useCli.setState({ server: { state: "off", connections: 0 } });
  assert.equal(cliDisclosure.getState().shown, false);
  assert.deepEqual(late, [false]);
  unsubscribe();
});
