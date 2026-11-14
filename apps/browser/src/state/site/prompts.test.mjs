import assert from "node:assert/strict";
import { test } from "node:test";
const { showExternalApp } = await import("./prompts.ts");
const { pageOf } = await import("../tabs/pageState.ts");
const { engineCalls } = await import("../../test-native/ardiacore.ts");

const resolved = () => engineCalls.filter((c) => c.domain === "permissions" && c.verb === "resolveExternalApp").length;

const request = (id, app) => ({ id, url: `${app ? "zoommtg" : "miroapp"}://x`, scheme: app ? "zoommtg" : "miroapp", origin: "https://a.example", app, appPath: app ? `/Applications/${app}.app` : null, icon: null, title: app ? `Open “${app}”?` : "No application is set to open this link", message: null, remember: null });

test("a link no app on this Mac opens shows no prompt, as in Chrome", () => {
  const before = resolved();
  showExternalApp("t1", request("x1", null));
  assert.equal(pageOf("t1").externalApp, null);
  assert.equal(resolved(), before + 1, "the engine's pending request is answered, so nothing is left waiting");
});

test("a link an app opens asks, and a later link no app opens leaves that question up", () => {
  showExternalApp("t2", request("x2", "zoom.us"));
  assert.equal(pageOf("t2").externalApp?.id, "x2");
  showExternalApp("t2", request("x3", null));
  assert.equal(pageOf("t2").externalApp?.id, "x2");
});
