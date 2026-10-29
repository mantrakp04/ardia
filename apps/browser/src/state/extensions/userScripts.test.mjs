import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const PATH = "/private/tmp/data/Scripts/extension";
const installed = new Map();
const calls = [];
let folder = { state: "empty" };
let gate = null;
const fake = (globalThis.acTestUserScripts = {
  watching: [],
  writes: [],
  status: null,
  change: null,
  read: async () => folder,
  engine: {
    list: async (space) => [...(installed.get(space) ?? new Map()).values()],
    install: async (path, space) => {
      calls.push(["install", space]);
      if (gate) await gate;
      const exts = installed.get(space) ?? new Map();
      const prior = exts.get("abc");
      const next = { errors: [], ...prior, id: "abc", path };
      if (prior?.blockedByPolicy && prior.liftsOnInstall) Object.assign(next, { blockedByPolicy: false, enabled: !prior.userDisabled });
      else next.enabled = prior ? prior.enabled : true;
      next.state = next.enabled ? "ENABLED" : "DISABLED";
      exts.set("abc", next);
      installed.set(space, exts);
      return "abc";
    },
    reload: async (id, space) => void calls.push(["reload", space]),
    uninstall: async (id, space) => void (calls.push(["uninstall", space]), installed.get(space)?.delete(id)),
  },
});

const { useBrowser } = await import("../browser/store.ts");
const scripts = await import("./userScripts.ts");
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const space = (id, name, profileId) => ({ id, name, color: "blue", icon: null, createdAt: 0, profileId: profileId ?? id });
useBrowser.setState({ profiles: { default: { id: "default", name: "Personal", engineId: "" }, work: { id: "work", name: "Work", engineId: "work" } }, spaces: { default: space("default", "Personal") }, spaceOrder: ["default"] });
const lastWrite = () => {
  const { version, ...status } = fake.writes.at(-1);
  assert.equal(version, 1);
  return status;
};

scripts.startUserScripts();

test("nothing happens while the setting is off", async () => {
  folder = { state: "ready", generation: 1, path: PATH };
  await settle();
  assert.deepEqual(fake.watching, []);
  assert.equal(fake.writes.length, 0);
  assert.equal(calls.length, 0);
});

test("turning the setting on watches and loads into every space", async () => {
  useBrowser.getState().updateSettings({ cliControl: true });
  await settle();
  assert.deepEqual(fake.watching, [true]);
  assert.deepEqual(calls, [["install", ""]]);
  assert.deepEqual(lastWrite(), { generation: 1, spaces: { Personal: { ok: true } } });
});

test("the same generation again does nothing, a new one reloads in place", async () => {
  calls.length = 0;
  fake.change();
  await settle();
  assert.equal(calls.length, 0);
  folder = { state: "ready", generation: 2, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["install", ""]]);
  assert.equal(installed.get("").size, 1);
  assert.deepEqual(lastWrite(), { generation: 2, spaces: { Personal: { ok: true } } });
});

test("a space the user disabled it in stays disabled", async () => {
  calls.length = 0;
  installed.get("").get("abc").enabled = false;
  folder = { state: "ready", generation: 3, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["reload", ""]]);
  assert.equal(installed.get("").get("abc").enabled, false);
  assert.deepEqual(lastWrite(), { generation: 3, spaces: { Personal: { disabled: true } } });
  installed.get("").get("abc").enabled = true;
});

test("installing a now-valid folder over a copy the engine blocked loads it, and a block that stays is an error", async () => {
  calls.length = 0;
  Object.assign(installed.get("").get("abc"), { enabled: false, state: "DISABLED", blockedByPolicy: true, liftsOnInstall: true });
  folder = { state: "ready", generation: 31, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["install", ""]]);
  assert.equal(installed.get("").get("abc").enabled, true);
  assert.deepEqual(lastWrite(), { generation: 31, spaces: { Personal: { ok: true } } });
  calls.length = 0;
  Object.assign(installed.get("").get("abc"), { enabled: false, state: "DISABLED", blockedByPolicy: true, liftsOnInstall: false, errors: [] });
  folder = { state: "ready", generation: 32, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["install", ""]]);
  assert.match(lastWrite().spaces.Personal.error, /^Ardia Scripts can only hold content scripts/);
  Object.assign(installed.get("").get("abc"), { enabled: true, state: "ENABLED", blockedByPolicy: false });
});

test("a copy the user disabled and the engine then blocked comes back disabled once valid", async () => {
  calls.length = 0;
  Object.assign(installed.get("").get("abc"), { enabled: false, state: "DISABLED", blockedByPolicy: true, liftsOnInstall: true, userDisabled: true });
  folder = { state: "ready", generation: 33, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["install", ""]]);
  assert.deepEqual(lastWrite(), { generation: 33, spaces: { Personal: { disabled: true } } });
  Object.assign(installed.get("").get("abc"), { enabled: true, state: "ENABLED", userDisabled: false });
});

test("a refused manifest is never loaded, removes the copy Chrome read from disk, and reports the error", async () => {
  calls.length = 0;
  folder = { state: "invalid", generation: 4, path: PATH, error: 'manifest.json may not contain "permissions"' };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["uninstall", ""]]);
  assert.deepEqual(lastWrite(), { generation: 4, spaces: { Personal: { error: 'manifest.json may not contain "permissions"' } } });
});

test("a new space gets it, a space sharing data reports the same, duplicate names stay apart", async () => {
  calls.length = 0;
  folder = { state: "ready", generation: 5, path: PATH };
  fake.change();
  await settle();
  calls.length = 0;
  useBrowser.setState({
    spaces: { default: space("default", "Personal"), work: space("work", "Personal"), shared: space("shared", "Side", "work") },
    spaceOrder: ["default", "work", "shared"],
  });
  await settle();
  assert.deepEqual(calls, [["install", "work"]]);
  assert.deepEqual(lastWrite(), { generation: 5, spaces: { Personal: { ok: true }, "Personal (2)": { ok: true }, Side: { ok: true } } });
});

test("a newer generation mid-load drops the stale status and reconciles once more", async () => {
  calls.length = 0;
  const writes = fake.writes.length;
  let open;
  gate = new Promise((r) => (open = r));
  folder = { state: "ready", generation: 6, path: PATH };
  fake.change();
  await settle();
  folder = { state: "ready", generation: 7, path: PATH };
  fake.change();
  fake.change();
  gate = null;
  open();
  await settle();
  assert.deepEqual(fake.writes.slice(writes).map((w) => w.generation), [7]);
});

test("a folder swapped while Chrome was reading it isn't cached, and the load runs again", async () => {
  calls.length = 0;
  const writes = fake.writes.length;
  let open;
  gate = new Promise((r) => (open = r));
  folder = { state: "ready", generation: 71, path: PATH, token: "g71-a" };
  fake.change();
  await settle();
  folder = { state: "ready", generation: 71, path: PATH, token: "g71-b" };
  gate = null;
  open();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "install").map(([, p]) => p), ["", "", "work"]);
  assert.deepEqual(fake.writes.slice(writes).map((w) => w.generation), [71]);
});

test("a load the folder changed under forgets what that space had, so the old generation loads again", async () => {
  calls.length = 0;
  let open;
  gate = new Promise((r) => (open = r));
  folder = { state: "ready", generation: 72, path: PATH, token: "g72" };
  fake.change();
  await settle();
  folder = { state: "ready", generation: 71, path: PATH, token: "g71-c" };
  gate = null;
  open();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "install").map(([, p]) => p), ["", ""]);
  assert.equal(lastWrite().generation, 71);
});

test("extension/ gone at the generation it was loaded at still unloads, stays unloaded, and loads again if extension/ comes back", async () => {
  folder = { state: "ready", generation: 73, path: PATH };
  fake.change();
  await settle();
  calls.length = 0;
  folder = { state: "absent", generation: 73, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "uninstall").map(([, p]) => p).sort(), ["", "work"]);
  assert.deepEqual(lastWrite().spaces.Personal, { removed: true });
  calls.length = 0;
  folder = { state: "absent", generation: 73, path: PATH };
  fake.change();
  await settle();
  assert.equal(calls.length, 0);
  folder = { state: "ready", generation: 73, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "install").map(([, p]) => p), ["", "work"]);
});

test("removal uninstalls everywhere and says so", async () => {
  calls.length = 0;
  folder = { state: "absent", generation: 8, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "uninstall").map(([, p]) => p).sort(), ["", "work"]);
  assert.deepEqual(lastWrite(), { generation: 8, spaces: { Personal: { removed: true }, "Personal (2)": { removed: true }, Side: { removed: true } } });
});

test("turning the setting off stops watching and ignores changes", async () => {
  calls.length = 0;
  const writes = fake.writes.length;
  useBrowser.getState().updateSettings({ cliControl: false });
  await settle();
  assert.equal(fake.watching.at(-1), false);
  folder = { state: "ready", generation: 9, path: PATH };
  fake.change();
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(fake.writes.length, writes);
});
