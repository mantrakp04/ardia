import assert from "node:assert/strict";
import { test } from "node:test";
const { awayTitle, awayTitleText, pinAwareTooltip } = await import("./organize.ts");

const pinned = { url: "https://mail.example/", pinnedUrl: "https://mail.example/", title: "Inbox", customTitle: null };

test("a pinned tab at its pinned URL has no away title", () => {
  assert.equal(awayTitle(pinned), null);
  assert.equal(awayTitle({ ...pinned, pinnedUrl: null, url: "https://elsewhere.example/" }), null);
  assert.equal(pinAwareTooltip(pinned), "Inbox\nhttps://mail.example/");
});

test("a pinned tab that left its URL shows / and the page it is on", () => {
  const away = awayTitle({ ...pinned, url: "https://mail.example/thread/42", title: "Lunch on Friday" });
  assert.deepEqual(away, { pinned: null, page: "Lunch on Friday" });
  assert.equal(awayTitleText(away), "/ Lunch on Friday");
});

test("a renamed pinned tab keeps its name before the slash, and the page title replaces it after", () => {
  const tab = { ...pinned, customTitle: "Mail", url: "https://mail.example/thread/42", title: "Lunch on Friday" };
  assert.deepEqual(awayTitle(tab), { pinned: "Mail", page: "Lunch on Friday" });
  assert.equal(pinAwareTooltip(tab), "Mail / Lunch on Friday\nhttps://mail.example/thread/42");
});

test("an untitled page falls back to its address", () => {
  assert.deepEqual(awayTitle({ ...pinned, url: "https://www.mail.example/thread/42", title: "" }), { pinned: null, page: "mail.example/thread/42" });
});
