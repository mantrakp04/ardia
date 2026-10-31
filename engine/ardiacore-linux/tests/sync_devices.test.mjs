import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { Clock } from "../../../packages/sync/src/hlc.ts";
import { syncScope } from "../../../packages/sync/src/scope.ts";
import { emptyScope } from "../../../packages/sync/src/scopeState.ts";

const TOOL = process.env.SYNC_DEVICE_TOOL;
const scratch = mkdtempSync(join(tmpdir(), "ardia-sync-devices-"));
const folder = join(scratch, "Shared Sync Folder");
const tools = new Set();
let fakeNow = Date.UTC(2026, 9, 27);

after(() => {
  for (const tool of tools) tool.close();
  rmSync(scratch, { recursive: true, force: true });
});

class Tool {
  constructor(name) {
    this.child = spawn(TOOL, [join(scratch, `${name}-keys`), folder, name], { stdio: ["pipe", "pipe", "inherit"] });
    this.waiting = [];
    createInterface({ input: this.child.stdout }).on("line", (line) => this.waiting.shift()?.(JSON.parse(line)));
    tools.add(this);
  }
  async call(method, ...args) {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20_000);
      this.waiting.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
      this.child.stdin.write(`${JSON.stringify({ method: `ArdiaSync.${method}`, args })}\n`);
    });
    if (!reply.ok) throw Object.assign(new Error(reply.message ?? reply.code), { code: reply.code });
    return reply.value;
  }
  close() {
    tools.delete(this);
    this.child.stdin.end();
    this.child.kill();
  }
}

const ids = new Set();
function deviceId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let id;
  do id = Array.from({ length: 26 }, () => alphabet[Math.floor(Math.random() * 32)]).join("");
  while (ids.has(id));
  ids.add(id);
  return id;
}

class Device {
  constructor(name) {
    this.name = name;
    this.id = deviceId();
    this.tool = new Tool(name);
    this.state = emptyScope();
    this.clock = new Clock(this.id, null, () => fakeNow);
    this.store = new Map();
  }
  restart() {
    this.tool.close();
    this.tool = new Tool(this.name);
    this.state = JSON.parse(JSON.stringify(this.state));
    this.clock = new Clock(this.id, this.clock.last, () => fakeNow);
  }
  transport() {
    return {
      write: (scope, payload) => this.tool.call("write", folder, scope, payload),
      read: (scope, known) => this.tool.call("read", folder, scope, known),
      remove: (scope, ids) => this.tool.call("remove", folder, scope, ids),
    };
  }
  adapters() {
    return [
      {
        prefix: "x:",
        extract: () => ({ values: new Map(this.store) }),
        apply: (visible, changed) => {
          for (const key of changed) visible.has(key) ? this.store.set(key, visible.get(key)) : this.store.delete(key);
        },
      },
    ];
  }
  async sync(scope = "p:shared-profile") {
    fakeNow += 1000;
    assert.equal(await this.tool.call("chainStatus", folder), "ok");
    return syncScope({
      scope,
      state: this.state,
      transport: this.transport(),
      adapters: this.adapters(),
      clock: this.clock,
      device: this.id,
      now: () => fakeNow,
      options: { pruneGrace: 0, compactAfterFiles: 6, compactInterval: 0 },
    });
  }
}

const sorted = (device) => Object.fromEntries([...device.store].sort(([a], [b]) => a.localeCompare(b)));
async function rounds(devices, count = 2) {
  for (let i = 0; i < count; i++) for (const device of devices) await device.sync();
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });
}

test("two simulated Linux devices set up, join, merge concurrent and offline edits, survive a restart and reject tampering", { skip: !TOOL }, async () => {
  const a = new Device("device-a");
  const b = new Device("device-b");
  assert.equal(await a.tool.call("createPhrase", a.id), true);
  await a.tool.call("createChain", folder);
  const words = await a.tool.call("recoveryWords");
  assert.equal(words.length, 24);

  const stranger = new Device("stranger");
  assert.equal(await stranger.tool.call("createPhrase", stranger.id), true);
  const strangerWords = await stranger.tool.call("recoveryWords");
  stranger.tool.close();
  assert.deepEqual(await b.tool.call("enterPhrase", b.id, strangerWords.join(" "), folder), { error: "mismatch" });
  assert.deepEqual(await b.tool.call("enterPhrase", b.id, words.slice(0, 23).join(" "), folder), { error: "wordCount", count: 23 });
  const swapped = [...words];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  if (swapped[0] !== swapped[1]) assert.ok(["checksum", "mismatch"].includes((await b.tool.call("enterPhrase", b.id, swapped.join(" "), folder)).error));
  await assert.rejects(b.tool.call("write", folder, "p:shared-profile", "{}"), { code: "locked" });
  const numbered = words.map((word, i) => `${i + 1}. ${word.toUpperCase()}`).join("\n");
  assert.deepEqual(await b.tool.call("enterPhrase", b.id, numbered, folder), { ok: true });

  a.store.set("x:a-only", "from A");
  a.store.set("x:shared", "A first");
  await a.sync();
  b.store.set("x:b-offline", "written while B never synced");
  fakeNow += 5000;
  b.store.set("x:shared", "B later");
  await rounds([b, a, b, a]);
  assert.deepEqual(sorted(a), sorted(b));
  assert.equal(a.store.get("x:shared"), "B later");
  assert.equal(b.store.get("x:a-only"), "from A");
  assert.equal(a.store.get("x:b-offline"), "written while B never synced");

  a.store.delete("x:a-only");
  b.store.set("x:concurrent", "B");
  a.store.set("x:concurrent", "A newer");
  await b.sync();
  await rounds([a, b]);
  assert.equal(b.store.has("x:a-only"), false);
  assert.equal(b.store.get("x:concurrent"), "A newer");
  assert.deepEqual(sorted(a), sorted(b));

  b.restart();
  await assert.rejects(b.tool.call("read", folder, "p:shared-profile", []), { code: "locked" });
  assert.equal(await b.tool.call("unlock", b.id), true);
  b.store.set("x:after-restart", "B relaunched");
  await rounds([b, a]);
  assert.equal(a.store.get("x:after-restart"), "B relaunched");

  for (let i = 0; i < 8; i++) {
    a.store.set(`x:bulk-${i}`, `value ${i}`);
    await rounds([a, b], 1);
  }
  assert.deepEqual(sorted(a), sorted(b));

  const c = new Device("device-c");
  assert.deepEqual(await c.tool.call("enterPhrase", c.id, words.join(" "), folder), { ok: true });
  c.state.awaitRemote = true;
  await rounds([c, a, b, c]);
  assert.deepEqual(sorted(c), sorted(a));

  const before = new Set(walk(folder));
  b.store.set("x:tampered", "never applied");
  await b.sync();
  const fresh = walk(folder).filter((path) => !before.has(path) && path.endsWith(".nns"));
  assert.ok(fresh.length >= 1);
  for (const path of fresh) {
    const data = readFileSync(path);
    data[data.length - 1] ^= 1;
    writeFileSync(path, data);
  }
  await a.sync();
  assert.equal(a.store.has("x:tampered"), false);
  assert.ok(Object.keys(a.state.damaged).length >= 1);

  const secrets = ["from A", "B later", "B relaunched", "written while B never synced", "x:shared", "shared-profile", "device-a", "device-b"];
  for (const path of walk(folder)) {
    for (const secret of secrets) {
      assert.equal(path.includes(secret), false, path);
      if (statSync(path).isFile()) assert.equal(readFileSync(path).includes(secret), false, `${secret} in ${path}`);
    }
    if (statSync(path).isFile()) assert.equal((statSync(path).size - 32) % 1024, 0);
  }
  assert.equal(walk(folder).some((path) => path.includes(".ardia-staging-")), false);
});
