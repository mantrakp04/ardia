import assert from "node:assert/strict";
import { test } from "node:test";
const { readDocument } = await import("../../platform/documents.ts");
const { downloadGoogleFont, ensureGoogleFonts, googleFontFaces, isGoogleFamily, useGoogleFonts } = await import("./googleFonts.ts");

const FONT_URL = "https://fonts.gstatic.com/s/inter/v20/latin.woff2";
const face = (subset, weight, url) => `\x2f* ${subset} *\x2f\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(${url}) format('woff2');\n  unicode-range: U+0000-00FF;\n}\n`;
const CSS = face("latin-ext", 400, "https://fonts.gstatic.com/s/inter/v20/ext.woff2") + face("latin", 400, FONT_URL) + face("latin", 700, FONT_URL);
const WOFF2 = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2]);

function mockFetch(answer) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return answer(url);
  };
  return calls;
}

test("a Google font downloads once, Latin only, without cookies or a referrer", async () => {
  const calls = mockFetch((url) => (url.startsWith("https://fonts.googleapis.com/") ? new Response(CSS) : new Response(WOFF2)));
  await downloadGoogleFont("Inter");
  assert.deepEqual(
    calls.map((c) => c.url),
    ["https://fonts.googleapis.com/css2?family=Inter:wght@400;700", FONT_URL],
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
  }
  assert.deepEqual(googleFontFaces("Inter"), [{ weight: "400 700", data: "d09GMgABAg" }]);
  assert.deepEqual(JSON.parse(readDocument("google-font-inter.json")).faces, [{ weight: "400 700", data: "d09GMgABAg" }]);
  assert.equal(useGoogleFonts.getState().status.Inter, "ready");
  await downloadGoogleFont("Inter");
  assert.equal(calls.length, 2);
});

test("a family with spaces goes in the URL with plus signs", async () => {
  const calls = mockFetch((url) => (url.startsWith("https://fonts.googleapis.com/") ? new Response(CSS) : new Response(WOFF2)));
  await downloadGoogleFont("Playfair Display");
  assert.equal(calls[0].url, "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700");
  assert.ok(readDocument("google-font-playfair-display.json"));
});

test("a file that isn't WOFF2 fails quietly and stores nothing", async () => {
  mockFetch((url) => (url.startsWith("https://fonts.googleapis.com/") ? new Response(CSS) : new Response("<html>")));
  await downloadGoogleFont("Lobster");
  assert.equal(useGoogleFonts.getState().status.Lobster, "failed");
  assert.equal(readDocument("google-font-lobster.json"), null);
  assert.deepEqual(googleFontFaces("Lobster"), []);
});

test("a refused request fails quietly", async () => {
  mockFetch(() => new Response("nope", { status: 400 }));
  await downloadGoogleFont("Lora");
  assert.equal(useGoogleFonts.getState().status.Lora, "failed");
});

test("built-in and unsafe names never reach the network", async () => {
  const calls = mockFetch(() => new Response(CSS));
  for (const name of ["Charter", 'Bad"Name', "a;}b", "x".repeat(61), ""]) {
    assert.equal(isGoogleFamily(name), false, name);
    await downloadGoogleFont(name);
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(googleFontFaces("Charter"), []);
});

test("synced boosts download missing fonts once and skip ones that failed", async () => {
  const calls = mockFetch((url) => (url.startsWith("https://fonts.googleapis.com/") ? new Response(CSS) : new Response(WOFF2)));
  ensureGoogleFonts([{ font: "Lora" }, { font: "Charter" }, { font: null }, { font: "Inter" }, { font: "Roboto" }, { font: "Roboto" }]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(
    calls.map((c) => c.url).filter((url) => url.includes("googleapis")),
    ["https://fonts.googleapis.com/css2?family=Roboto:wght@400;700"],
  );
});
