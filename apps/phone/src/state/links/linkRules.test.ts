import assert from "node:assert/strict";
import test from "node:test";
import { heldAfterOnboarding, linkAction, type LinkState } from "./linkRules.ts";

const browsing: LinkState = { onboarding: false, syncEnabled: true, hasTab: (id) => id === "t1" };

test("a web link from another app opens in a new tab in front; anything else is ignored", () => {
  assert.deepEqual(linkAction({ kind: "open", url: " https://example.com/a " }, browsing), { kind: "openUrl", url: "https://example.com/a" });
  assert.deepEqual(linkAction({ kind: "open", url: "javascript:alert(1)" }, browsing), { kind: "none" });
  assert.deepEqual(linkAction({ kind: "open", url: "file:///etc/hosts" }, browsing), { kind: "none" });
});

test("search, voice search and incognito open the tray, with the query filled when given", () => {
  assert.deepEqual(linkAction({ kind: "search", query: "otters " }, browsing), { kind: "tray", query: "otters", incognito: false });
  assert.deepEqual(linkAction({ kind: "search", query: null }, browsing), { kind: "tray", query: "", incognito: false });
  assert.deepEqual(linkAction({ kind: "voiceSearch" }, browsing), { kind: "tray", query: "", incognito: false });
  assert.deepEqual(linkAction({ kind: "incognito" }, browsing), { kind: "tray", query: "", incognito: true });
});

test("a tab link switches to that tab when it is still open", () => {
  assert.deepEqual(linkAction({ kind: "tab", id: "t1" }, browsing), { kind: "switchTab", id: "t1" });
  assert.deepEqual(linkAction({ kind: "tab", id: "gone" }, browsing), { kind: "none" });
});

test("Mac tabs opens Spaces while syncing and Sync With Mac otherwise; the inbox link applies the inbox", () => {
  assert.deepEqual(linkAction({ kind: "macTabs" }, browsing), { kind: "spaces" });
  assert.deepEqual(linkAction({ kind: "macTabs" }, { ...browsing, syncEnabled: false }), { kind: "syncSettings" });
  assert.deepEqual(linkAction({ kind: "inbox" }, browsing), { kind: "inbox" });
});

test("while onboarding is up a link waits, except the inbox, and only the last one runs after it ends", () => {
  const onboarding = { ...browsing, onboarding: true };
  assert.deepEqual(linkAction({ kind: "open", url: "https://example.com/" }, onboarding), { kind: "hold" });
  assert.deepEqual(linkAction({ kind: "macTabs" }, onboarding), { kind: "hold" });
  assert.deepEqual(linkAction({ kind: "inbox" }, onboarding), { kind: "inbox" });
  assert.deepEqual(
    heldAfterOnboarding([
      { kind: "open", url: "https://a.example/" },
      { kind: "search", query: "x" },
      { kind: "open", url: "https://b.example/" },
    ]),
    [{ kind: "open", url: "https://b.example/" }],
  );
  assert.deepEqual(heldAfterOnboarding([]), []);
});
