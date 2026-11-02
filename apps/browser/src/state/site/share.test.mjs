import assert from "node:assert/strict";
import { test } from "node:test";
const { shareFromPage } = await import("./share.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");

const app = shellNativeModules.ArdiaApp;
const anchor = [99, 199, 2, 2];
const tab = { url: "https://news.example/story?utm_source=x&id=7", title: "Story", customTitle: null, windowId: "w1" };

async function shared(share, from = tab) {
  const calls = [];
  const saved = { share: app.share, shareText: app.shareText };
  app.share = (...args) => (calls.push(["share", ...args]), Promise.resolve());
  app.shareText = (...args) => (calls.push(["shareText", ...args]), Promise.resolve());
  try {
    await shareFromPage(from, share, anchor);
  } finally {
    Object.assign(app, saved);
  }
  return calls;
}

test("the page menu's Share… on a blank part shares the page as the toolbar's Share does: clean link and title, at the click", async () => {
  assert.deepEqual(await shared({ kind: "page", url: tab.url, title: "Story" }), [["share", "https://news.example/story?id=7", "Story", "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "page" }, { ...tab, customTitle: "Renamed" }), [["share", "https://news.example/story?id=7", "Renamed", "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "page" }, { ...tab, url: "ardia://settings" }), []);
});

test("a selection shares its text, a link its clean URL with the link's text, a video its source", async () => {
  assert.deepEqual(await shared({ kind: "text", text: "quoted words" }), [["shareText", "quoted words", "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "text", text: "" }), []);
  assert.deepEqual(await shared({ kind: "link", url: "https://a.example/p?fbclid=1&q=2", title: "A link" }), [["share", "https://a.example/p?q=2", "A link", "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "link", url: "javascript:alert(1)" }), []);
  assert.deepEqual(await shared({ kind: "video", url: "https://cdn.example/v.mp4" }), [["share", "https://cdn.example/v.mp4", null, "w1", anchor]]);
});

test("an image shares the picture's file, and its address only when the picture couldn't be read", async () => {
  const fileUrl = "file:///var/folders/x/T/Ardia%20Shared%20Images/1/cat.png";
  assert.deepEqual(await shared({ kind: "image", fileUrl, url: "https://img.example/cat.png", title: "A cat" }), [["share", fileUrl, "A cat", "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "image", url: "https://img.example/cat.png" }), [["share", "https://img.example/cat.png", null, "w1", anchor]]);
  assert.deepEqual(await shared({ kind: "image" }), []);
});
