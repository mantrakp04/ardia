import assert from "node:assert/strict";
import { test } from "node:test";
const { pageHostLabel, urlTrail } = await import("./url.ts");

const rest = { hovered: false, showFullUrl: false };
const full = { hovered: false, showFullUrl: true };
const hover = { hovered: true, showFullUrl: false };

test("a web page shows its host alone, with no page title", () => {
  assert.equal(pageHostLabel("https://www.example.com/a/b?q=1#top"), "example.com");
  assert.equal(urlTrail("https://www.example.com/a/b?q=1#top", "Example Page", rest), "");
});

test("Show Full URL adds the path, query and fragment, without a trailing slash", () => {
  assert.equal(urlTrail("https://www.example.com/a/b?q=1#top", "", full), "/a/b?q=1#top");
  assert.equal(urlTrail("https://example.com/docs/", "", full), "/docs");
  assert.equal(urlTrail("https://example.com/", "", full), "");
  assert.equal(urlTrail("http://localhost:8080/x", "", full), "/x");
});

test("hovering shows the whole path, trailing slash kept, whatever Show Full URL says", () => {
  assert.equal(urlTrail("https://example.com/docs/", "", hover), "/docs/");
  assert.equal(urlTrail("https://example.com/", "", { hovered: true, showFullUrl: true }), "/");
  assert.equal(urlTrail("ardia://settings/appearance", "Settings", hover), "/appearance");
});

test("the app's own pages keep host / title, and drop it with no title", () => {
  assert.equal(pageHostLabel("ardia://settings"), "ardia://settings");
  assert.equal(urlTrail("ardia://settings", "Settings", rest), " / Settings");
  assert.equal(urlTrail("chrome://extensions", "Extensions", rest), " / Extensions");
  assert.equal(urlTrail("ardia://settings", "", rest), "");
  assert.equal(urlTrail("ardia://history?q=x", "History", full), "?q=x");
});

test("a local file shows File and its decoded path on hover or with Show Full URL", () => {
  assert.equal(pageHostLabel("file:///Users/me/a%20b.html"), "File");
  assert.equal(urlTrail("file:///Users/me/a%20b.html", "a b.html", rest), "");
  assert.equal(urlTrail("file:///Users/me/a%20b.html", "", hover), " /Users/me/a b.html");
  assert.equal(urlTrail("file:///Users/me/100%.html", "", full), " /Users/me/100%.html");
});
