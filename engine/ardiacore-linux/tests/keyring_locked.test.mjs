import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { createLiveServices, LIVE_FIXTURE } from "../../../apps/linux/scripts/acceptance/lib/liveServices.mjs";
import { hostLiveClient, LIVE_CAPABILITIES } from "../../../apps/linux/src/hostLive.ts";
import { linuxLiveSources } from "../../../apps/linux/src/liveSources.ts";
import { live } from "../../../apps/browser/src/state/live/store.ts";
import { LiveError } from "../../../apps/browser/src/state/live/types.ts";

const { LIVE_HOST_TOOL, SYNC_DEVICE_TOOL, LIBSECRET, KEYRING_CONTROL, KEYRING_PASSWORD, DBUS_SESSION_BUS_ADDRESS } = process.env;
const ready = !!(LIVE_HOST_TOOL && SYNC_DEVICE_TOOL && LIBSECRET && KEYRING_CONTROL && KEYRING_PASSWORD && DBUS_SESSION_BUS_ADDRESS);
const STORE = `secret-service:${LIBSECRET}`;
const scratch = mkdtempSync(join(tmpdir(), "ardia-keyring-locked-"));
const folder = join(scratch, "Sync Folder");
const services = createLiveServices();
const children = new Set();
let server;

const keyring = (...args) => JSON.parse(execFileSync("python3", ["-I", KEYRING_CONTROL, DBUS_SESSION_BUS_ADDRESS, ...args], { encoding: "utf8", timeout: 30_000 }));
const lock = () => {
  keyring("lock");
  assert.equal(keyring("locked"), true);
};
const unlock = () => {
  keyring("unlock", KEYRING_PASSWORD);
  assert.equal(keyring("locked"), false);
};
const prompt = (answer) => new Promise((resolve, reject) => {
  execFile("python3", ["-I", KEYRING_CONTROL, DBUS_SESSION_BUS_ADDRESS, "prompt", answer, KEYRING_PASSWORD], { encoding: "utf8", timeout: 40_000 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`the keyring prompt (${answer}): ${stderr || error.message}`));
    else resolve(JSON.parse(stdout));
  });
});
async function answering(answer, run) {
  const shown = prompt(answer);
  const result = await run().catch((error) => error);
  assert.match(await shown, /Unlock/);
  if (result instanceof Error && !(result instanceof LiveError)) throw result;
  return result;
}

function launch(args) {
  const child = spawn(args[0], args.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
  children.add(child);
  const waiting = [];
  createInterface({ input: child.stdout }).on("line", (line) => waiting.shift()?.(JSON.parse(line)));
  let sequence = 0;
  return {
    send(message) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${message.method} timed out`)), 30_000);
        waiting.push((reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        child.stdin.write(`${JSON.stringify({ id: ++sequence, ...message })}\n`);
      });
    },
    async quit() {
      child.stdin.end();
      await new Promise((resolve) => (child.exitCode === null ? child.on("exit", resolve) : resolve()));
      children.delete(child);
    },
  };
}

function liveApp() {
  const tool = launch([LIVE_HOST_TOOL, STORE, String(server.address().port)]);
  const call = async (method, args) => {
    const reply = await tool.send({ method, args });
    if (reply.ok) return reply.value;
    throw Object.assign(new Error(reply.message), { code: reply.code });
  };
  const host = { bootstrap: { windowId: "w1", profileId: "default", capabilities: [...LIVE_CAPABILITIES] }, invoke: (method, { args }) => call(method, args) };
  return { tool, linux: linuxLiveSources(hostLiveClient(host, (source) => !!live().accounts[source])) };
}

function syncApp(name) {
  const tool = launch([SYNC_DEVICE_TOOL, STORE, folder, name]);
  return {
    tool,
    async call(method, ...args) {
      const reply = await tool.send({ method: method.startsWith("Tool.") ? method : `ArdiaSync.${method}`, args });
      if (!reply.ok) throw Object.assign(new Error(reply.message ?? reply.code), { code: reply.code });
      return reply.value;
    },
  };
}

const githubRequests = () => services.requests().filter((r) => r.host === "api.github.com").length;
const prFolder = { id: "lf-pr", profileId: "default", kind: "pullRequests", name: "PRs", icon: null, collapsed: false, sources: ["github"], filters: { authored: true, reviewRequests: true }, groupStacks: false, showCompleted: false, createdAt: 0 };
const files = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]));

before(async () => {
  if (!ready) return;
  mkdirSync(folder);
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => void services.handle(req, res, Buffer.concat(chunks).toString("utf8")).then((handled) => {
      if (!handled) {
        res.writeHead(404, { "content-length": 0 });
        res.end();
      }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  for (const child of children) child.kill();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

test("a Live token in a keyring locked at launch reads as a locked keyring, never as signed out, and recovers without a restart once the keyring opens", { skip: !ready }, async () => {
  unlock();
  const first = liveApp();
  await first.linux.connectGithub(LIVE_FIXTURE.github.token);
  assert.equal(live().accounts.github.login, LIVE_FIXTURE.github.login);
  assert.ok((await first.linux.SOURCES.github.fetch(prFolder)).length > 0);
  await first.tool.quit();
  const [token] = keyring("items", "dev.ardia.linux.LiveToken");
  assert.equal(token.account, "github");
  lock();

  const dismissed = liveApp();
  const before = githubRequests();
  const error = await answering("dismiss", () => dismissed.linux.SOURCES.github.fetch(prFolder));
  assert.ok(error instanceof LiveError, String(error));
  assert.equal(error.kind, "keyringLocked", error.message);
  assert.match(error.message, /Unlock your keyring/);
  assert.equal(githubRequests(), before);
  assert.deepEqual(keyring("items", "dev.ardia.linux.LiveToken").map((item) => [item.account, item.locked]), [["github", true]]);
  const items = await answering("unlock", () => dismissed.linux.SOURCES.github.fetch(prFolder));
  assert.ok(Array.isArray(items) && items.length > 0, String(items));
  assert.ok(githubRequests() > before);
  await dismissed.tool.quit();
  lock();

  const later = liveApp();
  assert.equal((await answering("dismiss", () => later.linux.SOURCES.github.fetch(prFolder))).kind, "keyringLocked");
  const stillBefore = githubRequests();
  unlock();
  assert.ok((await later.linux.SOURCES.github.fetch(prFolder)).length > 0);
  assert.ok(githubRequests() > stillBefore);
  await later.tool.quit();
  assert.deepEqual(keyring("items", "dev.ardia.linux.LiveToken"), [token]);
});

test("a sync key in a keyring locked at launch is named, the recovery phrase resumes with the key held in memory, and opening the keyring saves it or resumes without the phrase", { skip: !ready }, async () => {
  unlock();
  const device = "keyringdeviceaaaaaaaaaaaaa";
  const other = "otherdeviceaaaaaaaaaaaaaaa";
  const first = syncApp("first");
  assert.equal(await first.call("createPhrase", device), true);
  await first.call("createChain", folder);
  const words = await first.call("recoveryWords");
  assert.equal(words.length, 24);
  const [saved] = keyring("items", "dev.ardia.linux.SyncKey");
  assert.equal(saved.account, device);
  await first.tool.quit();
  lock();

  const second = syncApp("second");
  assert.equal(await answering("dismiss", () => second.call("unlock", device)), false);
  const lockedStatus = await second.call("status");
  assert.equal(lockedStatus.keyStoreStatus, "locked");
  assert.equal(lockedStatus.lastKeyStatus, "locked");
  assert.equal(lockedStatus.unlocked, false);
  assert.deepEqual(keyring("items", "dev.ardia.linux.SyncKey").map((item) => [item.account, item.locked]), [[device, true]]);
  assert.deepEqual(await answering("dismiss", () => second.call("enterPhrase", other, words.join(" "), folder)), { error: "keychain" });
  assert.deepEqual(await answering("dismiss", () => second.call("enterPhrase", device, words.join(" "), folder)), { ok: true });
  const held = await second.call("status");
  assert.equal(held.unlocked, true);
  assert.equal(held.lastKeyStatus, "locked");
  assert.equal(await second.call("chainStatus", folder), "ok");
  assert.equal(await second.call("unlock", device), true);
  assert.deepEqual(await second.call("enterPhrase", device, "", folder), { ok: true });
  assert.deepEqual(files(scratch).filter((path) => !path.startsWith(folder)), []);
  assert.equal(keyring("items", "dev.ardia.linux.SyncKey").length, 1);
  unlock();
  await second.call("Tool.advance", 31);
  assert.equal((await second.call("status")).lastKeyStatus, "ok");
  assert.deepEqual(keyring("items", "dev.ardia.linux.SyncKey"), [saved]);
  await second.tool.quit();
  lock();

  const third = syncApp("third");
  assert.equal(await answering("dismiss", () => third.call("unlock", device)), false);
  assert.deepEqual(await answering("dismiss", () => third.call("enterPhrase", device, "", folder)), { error: "keychain" });
  assert.deepEqual(await third.call("enterPhrase", other, "", folder), { error: "keychain" });
  assert.equal((await third.call("status")).unlocked, false);
  unlock();
  assert.equal((await third.call("status")).keyStoreStatus, "ok");
  assert.deepEqual(await third.call("enterPhrase", other, "", folder), { error: "keychain" });
  assert.deepEqual(await third.call("enterPhrase", device, "", folder), { ok: true });
  assert.equal((await third.call("status")).unlocked, true);
  assert.deepEqual(await third.call("recoveryWords"), words);
  await third.tool.quit();
  lock();

  const fourth = syncApp("fourth");
  assert.equal(await answering("unlock", () => fourth.call("unlock", device)), true);
  assert.equal((await fourth.call("status")).unlocked, true);
  await fourth.tool.quit();
  lock();

  const fifth = syncApp("fifth");
  assert.equal(await answering("dismiss", () => fifth.call("unlock", device)), false);
  assert.deepEqual(await answering("unlock", () => fifth.call("enterPhrase", device, words.join(" "), folder)), { ok: true });
  const status = await fifth.call("status");
  assert.equal(status.unlocked, true);
  assert.equal(status.lastKeyStatus, "ok");
  await fifth.tool.quit();
  assert.deepEqual(keyring("items", "dev.ardia.linux.SyncKey"), [saved]);
});
