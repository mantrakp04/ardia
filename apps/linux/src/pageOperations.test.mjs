import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pageOperations, pageOperationsHeader } from "../scripts/page-operations.mjs";
import { CLOSE_DOCUMENT_PICTURE_IN_PICTURE, PICTURE_IN_PICTURE_STATE, UNSAVED_WORK, WEB_STORE_REQUEST, hostPageScript } from "./hostPageScripts.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { webviews } from "../../browser/src/platform/webviews.ts";
import { copyLinkToSelection, copyPageUrl, jumpToSelection, replaceInField } from "../../browser/src/state/site/selection.ts";
import { runCommand } from "../../browser/src/state/commands/commands.ts";

const TABLE = new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_page_operations.h", import.meta.url);

function recordingView(answers = {}) {
  const scripts = [];
  const view = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === "evaluate") return async (script) => {
        scripts.push(script);
        for (const [prefix, answer] of Object.entries(answers)) if (script.startsWith(prefix)) return answer;
        return null;
      };
      return async () => null;
    },
  });
  return { view, scripts };
}

function pinned(text) {
  const bytes = Buffer.from(text, "utf8");
  return { length: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function tableRows() {
  const rows = new Map();
  for (const match of readFileSync(TABLE, "utf8").matchAll(/\{"(\w+)", (\d+), "([0-9a-f]{64})", LinuxPageOperationArgs::(\w+)\}/g)) {
    rows.set(match[1], { length: Number(match[2]), sha256: match[3], args: match[4] });
  }
  return rows;
}

function mountTab(url = "https://example.test/") {
  useBrowser.getState().hydrate({});
  const windowId = useBrowser.getState().createWindow({ url });
  const tabId = useBrowser.getState().windows[windowId].tabIds[0];
  return { windowId, tabId };
}

const operation = (name) => pageOperations().find((entry) => entry.name === name);

test("the pinned evaluation table matches the shared sources", () => {
  assert.equal(readFileSync(TABLE, "utf8"), pageOperationsHeader(), "ac_linux_page_operations.h is stale: run apps/linux/scripts/page-operations.mjs --write");
  const rows = tableRows();
  assert.deepEqual([...rows.keys()], pageOperations().map((entry) => entry.name));
  for (const entry of pageOperations()) {
    const row = rows.get(entry.name);
    assert.deepEqual({ length: row.length, sha256: row.sha256, args: row.args }, { ...pinned(entry.text), args: entry.args });
  }
});

test("the derived operation texts equal what the shared modules send at runtime", async () => {
  const { windowId, tabId } = mountTab();
  const { view, scripts } = recordingView({ [operation("hasSelection").text]: true, [operation("replaceInField").text]: { field: true, count: 1 } });
  webviews.set(tabId, view);
  try {
    await jumpToSelection(tabId);
    assert.equal(scripts.at(-1), operation("jumpToSelection").text);

    await copyPageUrl(tabId);
    assert.equal(scripts.at(-1), operation("hasSelection").text);

    await copyLinkToSelection(tabId);
    assert.equal(scripts.at(-1), operation("selectionContext").text);

    const result = await replaceInField(tabId, "a\"b", "c d", true);
    assert.deepEqual(result, { field: true, count: 1 });
    const replace = scripts.at(-1);
    assert.ok(replace.startsWith(operation("replaceInField").text));
    assert.equal(replace.slice(operation("replaceInField").text.length), `${JSON.stringify("a\"b")}, ${JSON.stringify("c d")}, true)`);

    runCommand({ command: "useSelectionForFind", arg: null, windowId });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(scripts.at(-1), operation("selectedText").text);
  } finally {
    webviews.delete(tabId);
  }
});

test("the page scripts Linux answers itself are accepted by the host page-script router", () => {
  for (const [method, script] of [["evaluate", PICTURE_IN_PICTURE_STATE], ["executeJavaScript", CLOSE_DOCUMENT_PICTURE_IN_PICTURE], ["evaluate", UNSAVED_WORK], ["evaluate", WEB_STORE_REQUEST]]) {
    assert.ok(hostPageScript(method, [script]), script.slice(0, 40));
  }
});
