import assert from "node:assert/strict";
import test from "node:test";
import { ALL_COVERS, coversToClose, heldAfterOnboarding, linkAction, opensLaunchTray, type LinkState } from "./linkRules.ts";

const browsing: LinkState = { onboarding: false, syncEnabled: true, canSearchByVoice: false, hasTab: (id) => id === "t1" };

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

test("voice search opens the voice screen once the phone can recognise speech", () => {
  assert.deepEqual(linkAction({ kind: "voiceSearch" }, { ...browsing, canSearchByVoice: true }), { kind: "voice" });
  assert.deepEqual(linkAction({ kind: "voiceSearch" }, { ...browsing, onboarding: true, canSearchByVoice: true }), { kind: "hold" });
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

test("a link waiting at the end of onboarding is what shows, not the launch tray", () => {
  assert.equal(opensLaunchTray(true, []), true);
  assert.equal(opensLaunchTray(false, []), false);
  assert.equal(opensLaunchTray(true, [{ kind: "open", url: "https://example.com/" }]), false);
  assert.equal(opensLaunchTray(true, [{ kind: "inbox" }]), true);
});

test("a link leaves one surface: Spaces, Sync With Mac, a page or a tab close the tray, the voice screen and any sheet or menu first", () => {
  for (const link of [{ kind: "macTabs" }, { kind: "open", url: "https://example.com" }, { kind: "tab", id: "t1" }] as const) {
    assert.deepEqual(coversToClose(linkAction(link, browsing)), ALL_COVERS, link.kind);
    assert.deepEqual(coversToClose(linkAction(link, { ...browsing, syncEnabled: false })), ALL_COVERS, link.kind);
  }
  assert.ok(coversToClose(linkAction({ kind: "macTabs" }, browsing)).includes("tray"));
});

test("a search link keeps the tray it reopens, voice keeps its screen, and links that do nothing close nothing", () => {
  assert.ok(!coversToClose(linkAction({ kind: "search", query: "otters" }, browsing)).includes("tray"));
  assert.ok(coversToClose(linkAction({ kind: "search", query: "otters" }, browsing)).includes("voice"));
  assert.ok(!coversToClose(linkAction({ kind: "voiceSearch" }, { ...browsing, canSearchByVoice: true })).includes("voice"));
  assert.ok(coversToClose(linkAction({ kind: "voiceSearch" }, { ...browsing, canSearchByVoice: true })).includes("tray"));
  assert.deepEqual(coversToClose(linkAction({ kind: "tab", id: "gone" }, browsing)), []);
  assert.deepEqual(coversToClose(linkAction({ kind: "macTabs" }, { ...browsing, onboarding: true })), []);
  assert.deepEqual(coversToClose(linkAction({ kind: "inbox" }, browsing)), []);
});
