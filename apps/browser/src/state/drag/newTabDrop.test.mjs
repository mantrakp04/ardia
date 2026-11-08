import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { openDroppedInTab, droppedInputs } = await import("./windowDrop.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const navigated = (id) => {
  const t = S().tabs[id];
  return t.page?.navigation?.url ?? t.url;
};

function newTabWindow() {
  S().hydrate({});
  const w = S().createWindow({});
  const tab = S().windows[w].tabIds[0];
  return { w, tab };
}

test("files dropped on a New Tab page: the first opens in that tab, the rest in background tabs", () => {
  const { w, tab } = newTabWindow();
  assert.equal(S().tabs[tab].url, "");
  openDroppedInTab(tab, [
    { kind: "file", url: "file:///Users/me/drop%20doc.pdf" },
    { kind: "file", url: "file:///Users/me/image.png" },
    { kind: "file", url: "file:///Users/me/note.txt" },
  ]);
  const win = S().windows[w];
  assert.equal(win.activeTabIds[win.profileId], tab);
  assert.equal(navigated(tab), "file:///Users/me/drop%20doc.pdf");
  const others = win.tabIds.filter((id) => id !== tab).map((id) => S().tabs[id].url);
  assert.deepEqual(others.sort(), ["file:///Users/me/image.png", "file:///Users/me/note.txt"]);
});

test("a link dropped on a New Tab page navigates it, and text searches", () => {
  const { tab } = newTabWindow();
  openDroppedInTab(tab, [{ kind: "url", url: "https://example.com/dropped" }]);
  assert.equal(navigated(tab), "https://example.com/dropped");
  const second = newTabWindow().tab;
  openDroppedInTab(second, [{ kind: "text", text: "ardia browser drop" }]);
  assert.match(navigated(second), /[?&]q=ardia(\+|%20)browser(\+|%20)drop/);
});

test("only absolute local file URLs and non-empty text become inputs", () => {
  assert.deepEqual(
    droppedInputs([
      { kind: "file", url: "file://server/share.pdf" },
      { kind: "file", url: "file:///a.html" },
      { kind: "text", text: "   " },
      { kind: "url", url: " https://a.example/ " },
    ]),
    ["file:///a.html", "https://a.example/"],
  );
});

test("a drop with nothing usable leaves the New Tab page as it was", () => {
  const { w, tab } = newTabWindow();
  openDroppedInTab(tab, [{ kind: "text", text: "" }]);
  assert.equal(S().tabs[tab].url, "");
  assert.equal(S().windows[w].tabIds.length, 1);
});
