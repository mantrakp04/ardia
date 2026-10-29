import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/ardia/linux/bootstrap.js", import.meta.url), "utf8");

function fixture(options = {}) {
  const calls = [];
  const timers = new Map();
  const delays = new Map();
  const handlers = new Map();
  let nextTimer = 0;
  const context = {
    location: { protocol: "chrome:", hostname: "ardia" },
    chrome: { send: (...args) => calls.push(args) },
    crypto: { randomUUID: () => "request" },
    __ardiaBootstrap: { windowId: "window", profileId: "default" },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, fn); delays.set(nextTimer, ms); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, fn) => handlers.set(name, fn),
    console: { error() {} },
    ...options,
  };
  context.window = context;
  context.top = options.top ?? context;
  runInNewContext(source, context);
  return { context, host: context.__ardiaHost, calls, timers, delays, handlers };
}

test("only the trusted top-level WebUI installs the bridge", () => {
  assert.equal(fixture({ location: { protocol: "https:", hostname: "ardia" } }).host, undefined);
  assert.equal(fixture({ location: { protocol: "chrome:", hostname: "settings" } }).host, undefined);
  assert.equal(fixture({ top: {} }).host, undefined);
  assert.equal(fixture({ chrome: undefined }).host, undefined);
  const { context, host } = fixture();
  assert.equal(host.bootstrap.windowId, "window");
  assert.equal(context.__ardiaBootstrap, undefined);
  assert.equal(Object.isFrozen(host), true);
  assert.equal(Object.getOwnPropertyDescriptor(context, "__ardiaHost").writable, false);
});

test("requests correlate out-of-order replies and preserve engine arguments", async () => {
  const { context, host, calls, timers } = fixture();
  const engine = host.call("history.query", "default", '{"maxUrls":5}');
  const invoke = host.invoke("tab.command", { id: 4, command: "goBack" });
  const first = calls[0][1];
  const second = calls[1][1];
  assert.equal(calls[0][0], "ardiaRequest");
  assert.equal(first[1], "engine.call");
  assert.equal(first[2].args, '{"maxUrls":5}');
  assert.equal(second[1], "host.invoke");
  context.__ardiaReply(second[0], true, { done: true });
  context.__ardiaReply(first[0], true, '{"entries":[]}');
  assert.equal((await invoke).done, true);
  assert.equal(await engine, '{"entries":[]}');
  assert.equal(timers.size, 0);
  context.__ardiaReply(first[0], false, "duplicate");
});

test("native failures, transport errors and timeouts reject", async () => {
  const f = fixture();
  const failed = f.host.invoke("unknown");
  f.context.__ardiaReply(f.calls[0][1][0], false, "unsupported");
  await assert.rejects(failed, { code: "ERR_ENGINE", message: "unsupported" });
  const structured = f.host.call("history.query", "default", "{}");
  f.context.__ardiaReply(f.calls.at(-1)[1][0], false, { code: "ERR_BAD_REPLY", message: "Malformed engine reply" });
  await assert.rejects(structured, { code: "ERR_BAD_REPLY", message: "Malformed engine reply" });
  const waiting = f.host.invoke("slow");
  const timeout = [...f.timers.values()][0];
  timeout();
  await assert.rejects(waiting, /timed out/);
  const broken = fixture({ chrome: { send() { throw new Error("transport failed"); } } });
  await assert.rejects(broken.host.invoke("test"), /transport failed/);
  assert.equal(broken.timers.size, 0);
});

test("event subscribers are independent and removable", () => {
  const { context, host } = fixture();
  const received = [];
  host.onEvent(() => { throw new Error("listener failed"); });
  const remove = host.onEvent((...args) => received.push(args));
  context.__ardiaEvent("ArdiaCEF", "onEngineEvent", { topic: "tabs.changed" });
  assert.equal(received.length, 1);
  assert.equal(received[0][2].topic, "tabs.changed");
  remove();
  context.__ardiaEvent("ArdiaCEF", "onEngineEvent", {});
  assert.equal(received.length, 1);
});

test("navigation rejects outstanding work and stops future requests", async () => {
  const { host, handlers, timers } = fixture();
  const waiting = host.invoke("test");
  handlers.get("pagehide")();
  await assert.rejects(waiting, /closed/);
  await assert.rejects(host.invoke("test"), /closed/);
  assert.equal(timers.size, 0);
});

test("final native writes are issued before the transport closes", async () => {
  const { host, handlers, calls } = fixture();
  let final;
  host.onBeforeClose(() => {
    final = host.invoke("session.write", { session: { tabs: {} } });
    final.catch(() => {});
  });
  const remove = host.onBeforeClose(() => { throw new Error("removed"); });
  remove();
  handlers.get("pagehide")();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1][2].method, "session.write");
  await assert.rejects(final, /closed/);
  await assert.rejects(host.invoke("session.write", {}), /closed/);
});

test("malformed requests and excessive concurrency fail before transport", async () => {
  const { host, calls, handlers } = fixture();
  await assert.rejects(host.call("history.query", "default", {}), /Invalid engine/);
  await assert.rejects(host.invoke("method", []), /Invalid host/);
  assert.equal(calls.length, 0);
  const pending = Array.from({ length: 256 }, () => host.invoke("test").catch(() => {}));
  await assert.rejects(host.invoke("overflow"), /Too many/);
  assert.equal(calls.length, 256);
  handlers.get("pagehide")();
  await Promise.all(pending);
});

test("interactive credential requests get longer deadlines than ordinary requests", () => {
  const f = fixture();
  void f.host.invoke("ArdiaShell.windowIdentity", { args: [] });
  void f.host.invoke("ArdiaPasswords.reveal", { args: ["", "https://a.test", "me"] });
  void f.host.invoke("ArdiaPasswords.export", { args: [""] });
  void f.host.invoke("ArdiaPasswords.unlock", { args: [""] });
  void f.host.invoke("ArdiaAutofill.cardNumber", { args: ["", "card-1"] });
  void f.host.invoke("ArdiaPasswords.save", { args: ["", "https://a.test", "me", "secret"] });
  void f.host.call("passwords.reveal", "", "{}");
  assert.deepEqual([...f.delays.values()], [30000, 180000, 900000, 180000, 180000, 30000, 30000]);
});

test("calendar requests that may open Evolution Data Server backends get room to finish", () => {
  const f = fixture();
  void f.host.invoke("ArdiaCalendar.status", { args: [] });
  void f.host.invoke("ArdiaCalendar.requestAccess", { args: [] });
  void f.host.invoke("ArdiaCalendar.sources", { args: [] });
  void f.host.invoke("ArdiaCalendar.objects", { args: [["work"], 0, 1] });
  void f.host.invoke("ArdiaCalendar.timezones", { args: ["work", []] });
  assert.deepEqual([...f.delays.values()], [30000, 120000, 60000, 120000, 30000]);
});
