import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../../test-native/index.ts");
const { runsJavaScript } = await import("./scriptUrls.ts");
const { DEFAULT_SETTINGS } = await import("./settings.ts");

test("javascript: URLs are caught however they're spelled", () => {
  for (const url of [
    "javascript:alert(1)",
    "javascript://%0Adocument.title=document.querySelector('input[type=password]').value",
    "JaVaScRiPt://%0Aalert(1)",
    "  javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript://x%0Aalert(1)",
    "jav\rascript:alert(1)",
  ]) assert.equal(runsJavaScript(url, DEFAULT_SETTINGS), true, JSON.stringify(url));
});

test("ordinary URLs and searches are not", () => {
  for (const url of ["https://example.com/javascript:x", "example.com", "about:blank", "javascript tutorial", "%6Aavascript:alert(1)", "file:///tmp/javascript:x"])
    assert.equal(runsJavaScript(url, DEFAULT_SETTINGS), false, JSON.stringify(url));
});
