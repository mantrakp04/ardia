import assert from "node:assert/strict";
import { test } from "node:test";
import { inkLayer, lightStatusIcons } from "./statusInk.ts";

const scene = { onboarding: false, voice: false, sheet: false, searching: false, surface: "browsing" as const };

test("the topmost layer decides the status bar, as in the Compose app's StatusBarInk", () => {
  assert.equal(inkLayer(scene), "page");
  assert.equal(inkLayer({ ...scene, surface: "deck" }), "deck");
  assert.equal(inkLayer({ ...scene, surface: "start" }), "search");
  assert.equal(inkLayer({ ...scene, searching: true }), "search");
  assert.equal(inkLayer({ ...scene, searching: true, sheet: true }), "sheet");
  assert.equal(inkLayer({ ...scene, sheet: true, voice: true }), "voice");
  assert.equal(inkLayer({ ...scene, voice: true, onboarding: true }), "cover");
});

test("icons are light on a dark background, under the sheet's scrim, in Incognito and on the voice screen", () => {
  const light = { cover: "#E7CFD3", surface: "#E7CFD3", deck: "#E7CFD3", incognito: false };
  const dark = { cover: "#342123", surface: "#342123", deck: "#342123", incognito: false };
  assert.equal(lightStatusIcons("page", light), null);
  assert.equal(lightStatusIcons("deck", light), false);
  assert.equal(lightStatusIcons("deck", dark), true);
  assert.equal(lightStatusIcons("search", light), false);
  assert.equal(lightStatusIcons("search", { ...light, incognito: true }), true);
  assert.equal(lightStatusIcons("cover", dark), true);
  assert.equal(lightStatusIcons("voice", light), true);
  assert.equal(lightStatusIcons("sheet", light), false);
  assert.equal(lightStatusIcons("sheet", { ...light, surface: "#8A7A7E" }), true);
});
