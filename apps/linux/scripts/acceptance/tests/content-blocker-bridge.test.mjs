import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { connectCdp, fetchJson } from "../lib/cdp.mjs";
import { launchEnvironment } from "../lib/ardia.mjs";
import { until } from "../lib/util.mjs";

const CHROMIUM = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
const available = await access(CHROMIUM, constants.X_OK).then(() => true, () => false);
const BRIDGE = new URL("../../../../../engine/ardiacore-linux/content-blocker/", import.meta.url);
const HELPER = new URL("../../../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_site_controls.cc", import.meta.url);

function cppLiterals(text) {
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join("");
}

async function nativeScripts() {
  const source = await readFile(HELPER, "utf8");
  const send = source.slice(source.indexOf("std::string SendScript("), source.indexOf("std::string PollScript("));
  const poll = source.slice(source.indexOf("std::string PollScript("), source.indexOf("base::DictValue BridgeRequest("));
  const head = cppLiterals(send.slice(0, send.indexOf("script.append(request_literal)")));
  const tail = cppLiterals(send.slice(send.indexOf("script.append(request_literal)")));
  return { send: (literal) => `${head}${literal}${tail}`, poll: cppLiterals(poll) };
}

const STAND_IN = {
  "manifest.json": JSON.stringify({ manifest_version: 3, name: "Ardia bridge stand-in", version: "1.0", permissions: ["storage"] }),
  "js/vapi.js": `chrome.extension.getBackgroundPage = () => ({ "\\u00b5Block": { isReadyPromise: Promise.resolve() } });
self.standIn = { whitelist: ["chrome-extension-scheme"], available: { easylist: { content: "filters", group: "ads", title: "EasyList", entryCount: 5 }, "fanboy-cookiemonster": { content: "filters", group: "annoyances", title: "Cookies", off: true, entryCount: 2 } }, messages: [] };`,
  "js/vapi-common.js": "",
  "js/vapi-client.js": `self.vAPI = { messaging: { send(channel, m) {
  const s = self.standIn;
  s.messages.push(channel + ":" + m.what);
  if (m.what === "getWhitelist") return Promise.resolve({ whitelist: [...s.whitelist], whitelistDefault: ["chrome-extension-scheme"] });
  if (m.what === "getLists") return Promise.resolve({ available: JSON.parse(JSON.stringify(s.available)), netFilterCount: 7, cosmeticFilterCount: 3 });
  if (m.what === "setWhitelist") { s.whitelist = m.whitelist.split("\\n").filter(Boolean); return Promise.resolve(null); }
  if (m.what === "applyFilterListSelection") { for (const id of Object.keys(s.available)) s.available[id].off = !m.toSelect.includes(id); return Promise.resolve(null); }
  return Promise.resolve(null);
} } };`,
  "assets/assets.json": JSON.stringify({ easylist: {} }),
};

describe("the content blocker bridge page in a stock Chromium", { skip: available ? false : `${CHROMIUM} is not installed`, timeout: 120000 }, () => {
  let root;
  let child;
  let browser;
  let page;
  let world;
  let scripts;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-acceptance-bridge-"));
    const extension = join(root, "extension");
    for (const [name, text] of Object.entries(STAND_IN)) {
      await mkdir(join(extension, name, ".."), { recursive: true });
      await writeFile(join(extension, name), text);
    }
    for (const name of await readdir(BRIDGE)) await copyFile(new URL(name, BRIDGE), join(extension, name));
    scripts = await nativeScripts();
    const scratch = join(root, "profile");
    await mkdir(join(scratch, "home"), { recursive: true });
    const args = [`--user-data-dir=${scratch}`, "--no-first-run", "--no-default-browser-check", "--password-store=basic", "--disable-background-networking",
      "--disable-component-update", "--disable-sync", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--enable-unsafe-extension-debugging",
      "--ozone-platform=headless", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--host-resolver-rules=MAP * ~NOTFOUND", "about:blank"];
    child = spawn(CHROMIUM, args, { stdio: "ignore", env: launchEnvironment({ scratch, background: false }), detached: true });
    const active = await until(() => readFile(join(scratch, "DevToolsActivePort"), "utf8").then((text) => text.includes("\n") && text, () => false), { timeout: 30000, label: "DevToolsActivePort" });
    const port = Number(active.split("\n")[0]);
    browser = await connectCdp((await fetchJson(`http://127.0.0.1:${port}/json/version`)).webSocketDebuggerUrl);
    const { id } = await browser.send("Extensions.loadUnpacked", { path: extension });
    const { targetId } = await browser.send("Target.createTarget", { url: `chrome-extension://${id}/ardia-linux-bridge.html` });
    const target = await until(async () => (await fetchJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.id === targetId && t.url.endsWith("/ardia-linux-bridge.html")), { timeout: 10000, label: "the bridge page" });
    page = await connectCdp(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    const { frameTree } = await page.send("Page.getFrameTree");
    ({ executionContextId: world } = await page.send("Page.createIsolatedWorld", { frameId: frameTree.frame.id, worldName: "ardia-native" }));
  });

  after(async () => {
    await browser?.send("Browser.close").catch(() => {});
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (child?.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {}
    if (root) await rm(root, { recursive: true, force: true });
  });

  const isolated = async (expression) => {
    const { result, exceptionDetails } = await page.send("Runtime.evaluate", { expression, contextId: world, returnByValue: true });
    assert.equal(exceptionDetails, undefined, JSON.stringify(exceptionDetails));
    return result.value;
  };

  let ticket = 0;
  async function call(op, args = {}) {
    const request = JSON.stringify({ ticket: ++ticket, op, args, deadlineMs: 15000, failNext: false });
    assert.equal(await isolated(scripts.send(JSON.stringify(request))), "sent");
    const mine = ticket;
    return until(async () => {
      const raw = await isolated(scripts.poll);
      const reply = raw ? JSON.parse(raw) : null;
      return reply?.ticket === mine ? reply : false;
    }, { timeout: 15000, interval: 25, label: `${op} reply` });
  }

  it("is reachable only through the DOM: the isolated world cannot see the bridge's globals", async () => {
    assert.equal(await isolated("typeof self.vAPI"), "undefined");
    assert.equal(await isolated("document.documentElement.getAttribute('data-ardia-bridge')"), "ready");
  });

  it("answers the native send and poll scripts with real dashboard messages and chrome.storage", async () => {
    const state = await call("state");
    assert.equal(state.value.enabled, true);
    assert.deepEqual(state.value.lists.map((l) => [l.id, l.enabled]), [["easylist", true], ["fanboy-cookiemonster", false]]);
    assert.deepEqual(await call("setAllowed", { host: "example.com", allowed: true }), { ticket: 2, value: null });
    assert.equal((await call("isAllowed", { host: "news.example.com" })).value, true);
    assert.equal((await call("setEnabled", { enabled: false })).value, null);
    assert.equal((await call("state")).value.enabled, false);
    assert.equal((await call("setList", { id: "fanboy-cookiemonster", enabled: true })).value, null);
    const after = (await call("state")).value;
    assert.deepEqual(after.allowedHosts, ["example.com"]);
    assert.equal(after.lists.find((l) => l.id === "fanboy-cookiemonster").enabled, true);
    assert.match((await call("drop")).error, /unknown operation/);
    const messages = await page.send("Runtime.evaluate", { expression: "self.standIn.messages", returnByValue: true });
    assert.ok(messages.result.value.every((m) => m.startsWith("dashboard:")), JSON.stringify(messages.result.value));
  });

  it("refuses to send before the page is ready", async () => {
    await page.send("Runtime.evaluate", { expression: "document.documentElement.removeAttribute('data-ardia-bridge')" });
    assert.equal(await isolated(scripts.send(JSON.stringify("{}"))), "bridge not ready");
    await page.send("Runtime.evaluate", { expression: "document.documentElement.setAttribute('data-ardia-bridge', 'ready')" });
  });
});
