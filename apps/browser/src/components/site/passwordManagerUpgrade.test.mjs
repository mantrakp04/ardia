import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native-stub.mjs");
const { useBrowser } = await import("../../store/browser.ts");
const { usePages, setBrowserId } = await import("../layout/pageState.ts");
const { startPasswordManager } = await import("./passwordManager.ts");

const engine = stub.passwordManagerEngine;
const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("someone updating from a build without the setting keeps Ardia's manager while any profile has logins in it, and moves to Apple Passwords once none do", async () => {
  engine.available = true;
  engine.logins = { "": [{ origin: "https://a.example", username: "me" }] };
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], settings: { showFullUrl: false } });
  assert.equal(S().settings.passwordManager, "ardia", "an existing install starts where it was");
  assert.deepEqual(S().settings.inferred?.includes("passwordManager"), true);

  const work = S().createProfile({ name: "Work" });
  const tabIn = (profileId) => {
    const windowId = S().createWindow({ url: "https://a.example/", profileId });
    return Object.values(S().tabs).find((t) => t?.windowId === windowId).id;
  };
  startPasswordManager();
  setBrowserId(tabIn("default"), 1);
  await settle();
  assert.equal(S().settings.passwordManager, "ardia", "Personal still has a login saved in Ardia");

  engine.logins = {};
  setBrowserId(tabIn(work), 2);
  await settle();
  assert.equal(S().settings.passwordManager, "ardia", "Personal was counted with a login, so nothing changes");
  usePages.setState({ browsers: {} });
});

test("a person's own choice of Ardia is never switched for them", async () => {
  engine.logins = {};
  S().updateSettings({ passwordManager: "ardia" });
  assert.equal(S().settings.inferred?.includes("passwordManager") ?? false, false);
  setBrowserId(Object.keys(S().tabs)[0], 3);
  await settle();
  assert.equal(S().settings.passwordManager, "ardia");
});
