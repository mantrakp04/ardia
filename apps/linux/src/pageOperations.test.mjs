import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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

const sharedSource = (path) => new URL(`../../browser/src/${path}`, import.meta.url);
const readShared = (path) => readFileSync(sharedSource(path), "utf8");
const CALL = /\.evaluate\b|\.evaluate<|executeJavaScript\(/g;

const CALLERS = {
  "components/extensions/ActionPopup.tsx": { calls: 1, path: "the extension view answers its size itself" },
  "state/app/scripting.ts": { calls: 1, path: "AppleScript, which Linux never starts" },
  "state/commands/commands.ts": { calls: 1, path: "the pinned selectedText operation" },
  "state/engines/actions.ts": { calls: 1, path: "the editedInput page command" },
  "state/extensions/webStore.ts": { calls: 1, path: "the webStoreRequest page command" },
  "state/media/media.ts": { calls: 2, path: "the pictureInPictureState and exitPictureInPicture page commands" },
  "state/site/selection.ts": { calls: 4, path: "the pinned selection operations" },
  "state/site/translate.ts": { calls: 6, path: "translation, which is unavailable on Linux" },
};

const sources = (dir) => readdirSync(sharedSource(dir), { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.|\/dev\//.test(file))
  .map((file) => `${dir}/${file}`);

test("every shared page evaluation is accounted for on Linux, so a new one can't silently resolve to null", () => {
  const found = {};
  for (const path of [...sources("state"), ...sources("components")]) {
    const calls = (readShared(path).match(CALL) ?? []).length;
    if (calls) found[path] = calls;
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(CALLERS).map(([path, { calls }]) => [path, calls])));
});

test("each accounted evaluation reaches the Linux path it is listed with", () => {
  const table = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_page_operations.h", import.meta.url), "utf8");
  const pinned = (text) => table.includes(`${text.length}, "${createHash("sha256").update(text).digest("hex")}"`);
  const commands = readShared("state/commands/commands.ts");
  const selection = commands.match(/web\.evaluate<string>\("([^"]+)"\)/)[1];
  assert.ok(pinned(selection), "Use Selection for Find's script is not a pinned operation");
  assert.ok(readShared("state/media/media.ts").includes(`const PIP_STATE = '${PICTURE_IN_PICTURE_STATE}';`));
  assert.ok(readShared("state/media/media.ts").includes(`executeJavaScript("${CLOSE_DOCUMENT_PICTURE_IN_PICTURE}")`));
  assert.ok(readShared("state/engines/actions.ts").includes(`const UNSAVED_WORK = \`${UNSAVED_WORK}\`;`));
  for (const [method, script] of [["evaluate", PICTURE_IN_PICTURE_STATE], ["executeJavaScript", CLOSE_DOCUMENT_PICTURE_IN_PICTURE], ["evaluate", UNSAVED_WORK], ["evaluate", WEB_STORE_REQUEST]]) {
    assert.ok(hostPageScript(method, [script]), script.slice(0, 40));
  }
  assert.match(readFileSync(new URL("./shims/web/HostExtensionWebView.tsx", import.meta.url), "utf8"), /if \(property === "evaluate"\) return extensionViewEvaluate\(/);
  assert.match(readFileSync(new URL("./hostModules.ts", import.meta.url), "utf8"), /ArdiaTranslate: \{ available: false \}/);
  assert.match(readFileSync(new URL("../../../packages/shell/src/translation.ts", import.meta.url), "utf8"), /TranslationNative\.available \? TranslationNative : null/);
  const linuxSources = readdirSync(new URL(".", import.meta.url), { recursive: true }).filter((file) => /\.tsx?$/.test(file));
  for (const file of linuxSources) assert.doesNotMatch(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), /\bstartScripting\b|\bstartAppIntegration\b/, file);
});
