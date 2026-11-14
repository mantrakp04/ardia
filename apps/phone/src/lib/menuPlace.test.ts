import assert from "node:assert/strict";
import test from "node:test";
import { menuHeight, menuTop } from "./menuPlace.ts";

const host = { x: 0, y: 0, width: 392, height: 873 };

test("a menu opens fully below the row that opened it, or fully above when there is no room", () => {
  const row = { x: 16, y: 300, width: 360, height: 52 };
  assert.equal(menuTop(row, host, 200, 8), 352);
  const low = { x: 16, y: 760, width: 360, height: 52 };
  assert.equal(menuTop(low, host, 200, 8), 560);
  assert.equal(menuTop(row, { ...host, y: 24 }, 200, 8), 328);
});

test("a menu too tall for either side keeps clear of the edges", () => {
  const row = { x: 16, y: 400, width: 360, height: 52 };
  assert.equal(menuTop(row, host, 700, 8), 165);
});

test("a menu's height counts its rows, headings and dividers", () => {
  assert.equal(menuHeight([{ heading: "Archive" }, { label: "a" }, { label: "b" }, "divider", { label: "c" }]), 8 + 28 + 46 * 3 + 9);
});
