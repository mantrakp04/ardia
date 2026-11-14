import assert from "node:assert/strict";
import { test } from "node:test";
import { turboModules } from "../test-native/reactNative.ts";

const calls = [];
turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    calls.push({ verb, args: JSON.parse(argsJson), windowId });
    return JSON.stringify(verb === "tab.create" ? { tab: calls.length } : { ok: true });
  },
  engineCall: async () => "{}",
};

const { mountPage, answerExternalAppsWith, externalAppDropped } = await import("../../../../packages/expo-windows/src/engine/pages.ts");

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("closing a page tells the engine to forget its pending app-link asks before the tab closes", async () => {
  const dropped = [];
  answerExternalAppsWith({
    ask: async () => null,
    forget: () => {},
    forgetPage: (page) => {
      dropped.push(page);
      externalAppDropped(page, "x7");
    },
  });
  const unmount = mountPage("asking-page", { url: "https://a.example/", windowId: "w" }, () => {});
  await settle();
  unmount();
  await settle();
  const order = calls.filter((call) => call.args.key === "asking-page" && (call.verb === "tab.close" || call.args.method === "externalAppForget")).map((call) => call.verb === "tab.close" ? "close" : `forget ${call.args.id}`);
  assert.deepEqual(dropped, ["asking-page"]);
  assert.deepEqual(order, ["forget x7", "close"]);
});
