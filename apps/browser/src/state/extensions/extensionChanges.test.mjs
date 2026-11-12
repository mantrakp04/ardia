import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const native = await import("../../test-native/index.ts");
const { useExtensions } = await import("./store.ts");
const actions = await import("./actions.ts");

const EXT = { id: "gone", name: "Gone", enabled: true, pinned: false, hasAction: true, incognito: false, mayModify: true, errors: [] };
const listed = [];
globalThis.acTestUserScripts = { engine: { list: async () => listed, install: async () => "x", reload: async () => {}, uninstall: async () => {} } };
native.shellNativeModules.ArdiaDialogs.confirm = async () => ({ confirmed: true, suppressed: false });
native.extensionAnswers.change = async () => {
  throw Object.assign(new Error("No such extension"), { code: "ERR_ENGINE" });
};
const leaked = [];
process.on("unhandledRejection", (error) => leaked.push(error));
const warn = console.warn;
console.warn = () => {};
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

test("every control on an extension the engine no longer has settles quietly and shows the engine's list", async (t) => {
  t.after(() => (console.warn = warn));
  const controls = {
    "turn off": () => actions.setEnabled("", EXT.id, false),
    pin: () => actions.setPinned("", EXT.id, true),
    "site access": () => actions.configure("", EXT.id, { siteAccess: "onClick" }),
    reload: () => actions.reload("", EXT.id),
    remove: () => actions.removeExtension("", EXT),
  };
  for (const [name, press] of Object.entries(controls)) {
    useExtensions.setState({ lists: { "": [EXT] } });
    void press();
    await settle();
    assert.deepEqual(leaked.map(String), [], `${name} left an unhandled rejection`);
    assert.deepEqual(useExtensions.getState().lists[""], [], `${name} kept showing the removed extension`);
  }
});
