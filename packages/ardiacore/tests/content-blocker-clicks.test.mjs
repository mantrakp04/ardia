import { test } from "node:test";
import assert from "node:assert/strict";
import { grant, offDirective, revoke, runOnPage } from "./blocker-scripts.mjs";

const background = (extra = {}) => ({
  document: {},
  µBlock: { isReadyPromise: Promise.resolve() },
  ardiaClickConsent: false,
  stops: 0,
  ardiaStopClicks() {
    this.stops++;
  },
  ...extra,
});

const dashboard = ({ whitelist = [], userSettings } = {}) => (message) => {
  if (message.what === "getWhitelist") return whitelist instanceof Error ? Promise.reject(whitelist) : Promise.resolve({ whitelist });
  if (message.what === "userSettings") return userSettings ? userSettings(message) : Promise.resolve({});
  return Promise.reject(new Error(`unexpected ${message.what}`));
};

async function waitForReply(reply, granting) {
  let settled = false;
  granting.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 1000;
  while (!reply()) {
    assert.ok(!settled, "the grant finished before reaching the deferred dashboard reply");
    assert.ok(Date.now() < deadline, "the grant did not reach the deferred dashboard reply within one second");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("revoking stops the switch without readiness, the whitelist or the dashboard", async () => {
  const b = background({ ardiaClickConsent: true, µBlock: {} });
  const result = await runOnPage(revoke(1), { background: b });
  assert.deepEqual(result, { value: null });
  assert.equal(b.ardiaClickConsent, false);
  assert.equal(b.stops, 1);
  assert.equal(b.ardiaClickToken, 1);
});

test("revoking before AdNauseam's code has run records it and succeeds", async () => {
  const b = { ardiaClickConsent: undefined };
  assert.deepEqual(await runOnPage(revoke(2), { background: b }), { value: null });
  assert.equal(b.ardiaClickToken, 2);
  assert.equal(b.ardiaClickConsent, false);
});

test("a grant whose dashboard answer arrives after a revoke leaves clicking off", async () => {
  const b = background();
  let answer;
  const granting = runOnPage(grant(true, 0), {
    background: b,
    send: dashboard({ userSettings: () => new Promise((resolve) => (answer = resolve)) }),
  });
  await waitForReply(() => answer, granting);
  await runOnPage(revoke(1), { background: b });
  answer({});
  assert.deepEqual(await granting, { value: null });
  assert.equal(b.ardiaClickConsent, false);
});

test("a grant queued before a revoke can't reopen the switch when it runs later", async () => {
  const b = background();
  await runOnPage(revoke(1), { background: b });
  await runOnPage(grant(true, 0), { background: b, send: dashboard() });
  assert.equal(b.ardiaClickConsent, false);
});

test("a grant waiting on the whitelist cannot cross a background reload after revocation", async () => {
  let b = background();
  let answer;
  const granting = runOnPage(grant(true, 1), {
    background: () => b,
    send: (message) => message.what === "getWhitelist"
      ? new Promise((resolve) => { answer = resolve; })
      : Promise.resolve({}),
  });
  await waitForReply(() => answer, granting);
  await runOnPage(revoke(2), { background: b });
  b = background();
  answer({ whitelist: [] });
  const result = await granting;
  assert.equal(b.ardiaClickConsent, false);
  assert.match(result.error, /background restarted/);
});

test("a grant's delayed settings answer cannot enable a replacement document in the same window", async () => {
  const b = background();
  let answer;
  const granting = runOnPage(grant(true, 1), {
    background: b,
    send: dashboard({ userSettings: () => new Promise((resolve) => { answer = resolve; }) }),
  });
  await waitForReply(() => answer, granting);
  await runOnPage(revoke(2), { background: b });
  Object.assign(b, background());
  delete b.ardiaClickToken;
  answer({});
  const result = await granting;
  assert.equal(b.ardiaClickConsent, false);
  assert.match(result.error, /background restarted/);
});

test("a grant waiting for startup cannot follow a restarted background", async () => {
  let ready;
  let b = background({ µBlock: { isReadyPromise: new Promise((resolve) => { ready = resolve; }) } });
  const granting = runOnPage(grant(true, 1), { background: () => b, send: dashboard() });
  await new Promise((resolve) => setImmediate(resolve));
  await runOnPage(revoke(2), { background: b });
  b = background();
  ready();
  const result = await granting;
  assert.equal(b.ardiaClickConsent, false);
  assert.match(result.error, /background restarted/);
});

test("a grant made after the revoke opens it, and sets clickingAds", async () => {
  const b = background({ ardiaClickToken: 1 });
  const settings = [];
  await runOnPage(grant(true, 2), { background: b, send: dashboard({ userSettings: (m) => (settings.push([m.name, m.value]), Promise.resolve({})) }) });
  assert.equal(b.ardiaClickConsent, true);
  assert.equal(b.ardiaClickToken, 2);
  assert.deepEqual(settings, [["clickingAds", true]]);
});

test("a revoke arriving late never lowers the token, so the pending grant before both stays shut", async () => {
  const b = background();
  let answer;
  const granting = runOnPage(grant(true, 1), {
    background: b,
    send: dashboard({ userSettings: () => new Promise((resolve) => (answer = resolve)) }),
  });
  await waitForReply(() => answer, granting);
  await runOnPage(revoke(2), { background: b });
  await runOnPage(revoke(1), { background: b });
  answer({});
  await granting;
  assert.equal(b.ardiaClickToken, 2);
  assert.equal(b.ardiaClickConsent, false);
});

test("the last intent wins: a revoke older than the applied grant leaves clicking on", async () => {
  const b = background();
  await runOnPage(grant(true, 2), { background: b, send: dashboard() });
  await runOnPage(revoke(1), { background: b });
  assert.equal(b.ardiaClickConsent, true);
  assert.equal(b.stops, 0);
  assert.equal(b.ardiaClickToken, 2);
});

test("the queued clickingAds sync of an older revoke can't turn off a newer grant", async () => {
  const b = background();
  const settings = [];
  const send = dashboard({ userSettings: (m) => (settings.push([m.name, m.value]), Promise.resolve({})) });
  await runOnPage(grant(true, 2), { background: b, send });
  await runOnPage(grant(false, 1), { background: b, send });
  assert.equal(b.ardiaClickConsent, true);
  assert.deepEqual(settings, [["clickingAds", true]]);
});

test("a revoke's own clickingAds sync with the same token turns clickingAds off", async () => {
  const b = background({ ardiaClickConsent: true });
  const settings = [];
  await runOnPage(revoke(3), { background: b });
  await runOnPage(grant(false, 3), { background: b, send: dashboard({ userSettings: (m) => (settings.push([m.name, m.value]), Promise.resolve({})) }) });
  assert.equal(b.ardiaClickConsent, false);
  assert.deepEqual(settings, [["clickingAds", false]]);
});

test("a failed whitelist read never opens the switch", async () => {
  const b = background();
  const result = await runOnPage(grant(true, 0), { background: b, send: dashboard({ whitelist: new Error("getWhitelist failed") }) });
  assert.match(result.error, /getWhitelist failed/);
  assert.equal(b.ardiaClickConsent, false);
});

test("while blocking is off a grant keeps the switch closed and stops what's in flight", async () => {
  const b = background({ ardiaClickConsent: true });
  await runOnPage(grant(true, 0), { background: b, send: dashboard({ whitelist: [offDirective] }) });
  assert.equal(b.ardiaClickConsent, false);
  assert.equal(b.stops, 1);
});
