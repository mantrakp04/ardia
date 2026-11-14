import assert from "node:assert/strict";
import { test } from "node:test";
const { downloadStatus } = await import("./status.ts");

const downloading = { url: "https://dl.example.com/a.dmg", state: "downloading", paused: false, dangerous: false, received: 29e6, total: 120e6, speed: 1.2e6 };

test("a download with a known size shows progress, speed and time left", () => {
  assert.equal(downloadStatus(downloading), "29 MB of 120 MB, 1.2 MB/s — 1 min left");
});

test("a download whose server sends no size still shows its speed", () => {
  assert.equal(downloadStatus({ ...downloading, total: -1 }), "29 MB, 1.2 MB/s");
});

test("before the first speed sample only the bytes show", () => {
  assert.equal(downloadStatus({ ...downloading, total: -1, speed: 0 }), "29 MB");
  assert.equal(downloadStatus({ ...downloading, speed: 0 }), "29 MB of 120 MB");
});

test("a paused download shows no speed", () => {
  assert.equal(downloadStatus({ ...downloading, paused: true }), "29 MB of 120 MB — Paused");
});
