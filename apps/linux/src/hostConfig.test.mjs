import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import { startHostConfig } from "./hostConfig.ts";

const CONFIG_METHODS = ["ArdiaConfig.readFile", "ArdiaConfig.watch", "ArdiaConfig.writeSchemas"];

function configHost(capabilities, files = {}) {
  const invoked = [];
  const listeners = [];
  return {
    invoked,
    files,
    emit: (module, event, payload) => listeners.forEach((listener) => listener(module, event, payload)),
    host: {
      bootstrap: { windowId: "w1", profileId: "default", capabilities, nativeModules: {} },
      invoke: async (method, args) => {
        invoked.push([method, args.args]);
        if (method === "ArdiaConfig.readFile") return Object.hasOwn(files, args.args[0]) ? { status: "ok", text: files[args.args[0]] } : { status: "missing" };
        if (method === "ArdiaConfig.writeSchemas") return ["/data/config-schema/config.schema.json"];
        return undefined;
      },
      call: async () => "{}",
      onEvent: (listener) => {
        listeners.push(listener);
        return () => {};
      },
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an engine without the config methods reads no folder and never reaches the host", async () => {
  const { host, invoked } = configHost([]);
  await startHostConfig(host, () => assert.fail("no change without a host"));
  assert.deepEqual(resolveHostModule(host, "ArdiaConfig", "readFile")("config.json"), { status: "missing" });
  assert.equal(await resolveHostModule(host, "ArdiaConfig", "watch")(["config.json"]), undefined);
  assert.deepEqual(await resolveHostModule(host, "ArdiaConfig", "writeSchemas")({ "config.schema.json": "{}" }), []);
  assert.deepEqual(invoked, []);
});

test("config.json and the theme it names are read before the UI starts, and answer synchronously", async () => {
  const { host, invoked } = configHost(CONFIG_METHODS, { "config.json": '{"theme": "nord"}', "themes/nord.json": '{"dark": {}}' });
  await startHostConfig(host, () => {});
  const readFile = resolveHostModule(host, "ArdiaConfig", "readFile");
  assert.deepEqual(readFile("config.json"), { status: "ok", text: '{"theme": "nord"}' });
  assert.deepEqual(readFile("themes/nord.json"), { status: "ok", text: '{"dark": {}}' });
  assert.deepEqual(invoked.map(([, args]) => args[0]), ["config.json", "themes/nord.json"]);
  await resolveHostModule(host, "ArdiaConfig", "watch")(["config.json", "themes/nord.json"]);
  assert.deepEqual(await resolveHostModule(host, "ArdiaConfig", "writeSchemas")({ "config.schema.json": "{}" }), ["/data/config-schema/config.schema.json"]);
  assert.deepEqual(invoked.slice(2), [["ArdiaConfig.watch", [["config.json", "themes/nord.json"]]], ["ArdiaConfig.writeSchemas", [{ "config.schema.json": "{}" }]]]);
});

test("a change on disk refreshes the files, the newly named theme included, before the shared code hears of it", async () => {
  const { host, files, emit } = configHost(CONFIG_METHODS, { "config.json": '{"theme": "nord"}', "themes/nord.json": "{}" });
  const seen = [];
  const readFile = resolveHostModule(host, "ArdiaConfig", "readFile");
  await startHostConfig(host, () => seen.push([readFile("config.json").text, readFile("themes/dracula.json").text, readFile("themes/nord.json").text]));
  files["config.json"] = '{"theme": "dracula"}';
  files["themes/dracula.json"] = '{"light": {}}';
  delete files["themes/nord.json"];
  emit("ArdiaConfig", "onChange", {});
  await settle();
  assert.deepEqual(seen, []);
  emit("ArdiaConfig", "onFilesChanged", {});
  emit("ArdiaConfig", "onFilesChanged", {});
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(seen, [['{"theme": "dracula"}', '{"light": {}}', undefined]]);
  assert.deepEqual(readFile("themes/nord.json"), { status: "missing" });
});

test("a file the cache doesn't hold answers missing once, then is read and announced", async () => {
  const { host, files } = configHost(CONFIG_METHODS, { "config.json": "{}" });
  let announced = 0;
  await startHostConfig(host, () => announced++);
  const readFile = resolveHostModule(host, "ArdiaConfig", "readFile");
  files["themes/late.json"] = "{}";
  assert.deepEqual(readFile("themes/late.json"), { status: "missing" });
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(announced, 1);
  assert.deepEqual(readFile("themes/late.json"), { status: "ok", text: "{}" });
});
