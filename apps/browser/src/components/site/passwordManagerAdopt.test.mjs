import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native-stub.mjs");
const { useBrowser } = await import("../../store/browser.ts");
const { setBrowserId } = await import("../layout/pageState.ts");
const { startPasswordManager } = await import("./passwordManager.ts");

const engine = stub.passwordManagerEngine;
const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an updated install with no logins saved in Ardia moves to Apple Passwords once every profile has been checked", async () => {
  engine.available = true;
  engine.logins = {};
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], settings: { showFullUrl: false } });
  const work = S().createProfile({ name: "Work" });
  const tabIn = (profileId) => {
    const windowId = S().createWindow({ url: "https://a.example/", profileId });
    return Object.values(S().tabs).find((t) => t?.windowId === windowId).id;
  };
  startPasswordManager();
  setBrowserId(tabIn("default"), 1);
  await settle();
  assert.equal(S().settings.passwordManager, "ardia", "Work hasn't loaded yet, so its logins are unknown");

  setBrowserId(tabIn(work), 2);
  await settle();
  assert.equal(S().settings.passwordManager, "apple");
  assert.deepEqual(engine.calls.filter((c) => c[0] === "applePasswords").at(-1), ["applePasswords", true]);
});
