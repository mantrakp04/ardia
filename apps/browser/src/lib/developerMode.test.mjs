import assert from "node:assert/strict";
import { test } from "node:test";
import { developerHostOf, developerModeOf, isDeveloperMode, NO_DEVELOPER_MODE, withDeveloperMode } from "./developerMode.ts";

const none = NO_DEVELOPER_MODE;

test("default hosts are in Developer Mode on any port and path", () => {
  for (const url of ["http://localhost:3000/app?x=1", "https://localhost/", "http://127.0.0.1:8080/", "http://[::1]:5173/", "http://app.localhost:4000/", "http://LOCALHOST:3000/"])
    assert.equal(isDeveloperMode(url, none), true, url);
});

test("a default host can be switched off and back on, and goes in disabledDefaultHosts", () => {
  const off = withDeveloperMode(none, "http://localhost:3000/", false);
  assert.deepEqual(off, { on: [], off: ["localhost"], reload: "reload" });
  assert.equal(isDeveloperMode("http://localhost:4000/x", off), false);
  assert.equal(isDeveloperMode("http://127.0.0.1/", off), true);
  assert.deepEqual(withDeveloperMode(off, "http://localhost/", true), none);
});

test("other sites are off until switched on, per host", () => {
  assert.equal(isDeveloperMode("https://example.com/a", none), false);
  const state = withDeveloperMode(none, "https://www.example.com:8443/path?q", true);
  assert.deepEqual(state.on, ["example.com"]);
  assert.equal(isDeveloperMode("http://www.example.com/", state), true);
  assert.equal(isDeveloperMode("https://sub.example.com/", state), false);
  assert.deepEqual(withDeveloperMode(state, "https://example.com/", false), none);
  assert.deepEqual(withDeveloperMode(withDeveloperMode(state, "https://b.com/", true), "https://example.com/", true).on, ["b.com", "example.com"]);
});

test("only http and https pages have Developer Mode", () => {
  for (const url of ["file:///Users/me/index.html", "about:blank", "ardia://settings", "not a url", "", "chrome://version"]) {
    assert.equal(developerHostOf(url), null, url);
    assert.equal(isDeveloperMode(url, none), false, url);
    assert.equal(withDeveloperMode(none, url, true), none, url);
  }
});

test("stored and synced state is sanitized", () => {
  assert.deepEqual(developerModeOf(null), none);
  assert.deepEqual(developerModeOf({ on: ["A.com", "a.com", "localhost", 3, ""], off: ["localhost", "example.com"], reload: "forceReload" }), {
    on: ["a.com"],
    off: ["localhost"],
    reload: "forceReload",
  });
  assert.equal(developerModeOf({ reload: "bogus" }).reload, "reload");
});
