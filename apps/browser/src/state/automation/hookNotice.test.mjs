import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { offerLaunchActions, reloadHooks, startHookRules } = await import("./hookRules.ts");
const { approveRule, resetApprovalsForTests } = await import("./approvals.ts");
const { launchActionApproval } = await import("./hookPolicy.ts");
const { useToasts } = await import("../app/toasts.ts");
const { firstWindowCommitted } = await import("../../lib/afterFirstWindow.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const toastIn = (windowId) => useToasts.getState().toasts[windowId] ?? null;

test("rules offered before the first window and by launchActions at launch are announced together once the window is up", async () => {
  S().hydrate({});
  resetApprovalsForTests();
  assert.equal(S().windowOrder.length, 0);
  stub.configFolder.files.set(
    "hooks.json",
    JSON.stringify({ hooks: [{ name: "old-reddit", on: "tab.opening", rewrite: [{ match: "https://www.reddit.com/*", to: "https://old.reddit.com{path}" }] }] }),
  );
  startHookRules();
  reloadHooks();

  const w = S().createWindow({ url: "https://a.example/" });
  assert.equal(toastIn(w), null);
  firstWindowCommitted();
  offerLaunchActions(["closeTab", "closeAllTabs", "toggleSidebar"]);
  approveRule(launchActionApproval("closeAllTabs").key);
  assert.equal(toastIn(w), null, "launch-time offers wait for the one combined notice");
  for (let i = 0; i < 4; i++) await tick();

  const toast = toastIn(w);
  assert.ok(toast, "a notice shows in the first window");
  assert.match(toast.title, /hooks\.json/);
  assert.match(toast.title, /config\.json/);
  assert.match(toast.title, /2 automation rules wait/);

  stub.configFolder.files.set(
    "hooks.json",
    JSON.stringify({ hooks: [{ name: "to-archive", on: "tab.opening", rewrite: [{ match: "https://news.example/*", to: "https://archive.example{path}" }] }] }),
  );
  reloadHooks();
  assert.equal(toastIn(w).title, "hooks.json: “to-archive” waits for your approval", "after launch a new rule is announced at once");
});
