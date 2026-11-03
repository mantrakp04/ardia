import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const { formatUrl, urlParts, webUrl } = await import("./urlParts.ts");
const { matchesUrl, parseMatchPattern } = await import("./matchPattern.ts");
const { applyTemplate, safeRewriteTarget, sameOrigin } = await import("../state/automation/hookPolicy.ts");
const { providerRows } = await import("../state/automation/omniboxHooks.ts");

const require = createRequire(import.meta.url);

async function reactNativeUrl() {
  const file = require.resolve("react-native/Libraries/Blob/URL.js");
  const babel = require("@babel/core");
  const source = readFileSync(file, "utf8")
    .replace(/^import type .*$/gm, "")
    .replace(/^import NativeBlobModule from .*$/m, "const NativeBlobModule = null;")
    .replace(/^export \{URLSearchParams\} from .*$/m, "");
  const { code } = babel.transformSync(source, { babelrc: false, configFile: false, filename: file, plugins: [require.resolve("@babel/plugin-transform-flow-strip-types")] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return module.URL;
}

async function withAppUrl(run) {
  const AppUrl = await reactNativeUrl();
  assert.equal(new AppUrl("http://127.0.0.1:18800/page.html").href, "http://127.0.0.1:18800/page.html/");
  const original = globalThis.URL;
  globalThis.URL = AppUrl;
  try {
    return await run();
  } finally {
    globalThis.URL = original;
  }
}

test("urls split and format without adding or losing a slash", () => {
  assert.equal(formatUrl(urlParts("http://127.0.0.1:18800/page.html")), "http://127.0.0.1:18800/page.html");
  assert.equal(formatUrl(urlParts("HTTPS://Example.COM:443/a?b=1#c")), "https://example.com/a?b=1#c");
  assert.equal(formatUrl(urlParts("https://example.com")), "https://example.com/");
  assert.equal(webUrl("https://user:pw@example.com/"), null);
  assert.equal(webUrl("javascript:alert(1)"), null);
  assert.equal(webUrl("https://exa mple.com/"), null);
  assert.equal(webUrl("https:///nohost"), null);
  assert.equal(urlParts("file:///tmp/x").path, "/tmp/x");
});

test("with React Native's URL as the global, rewrites, omnibox rows and matching keep the exact URL", async () => {
  await withAppUrl(() => {
    const stripped = safeRewriteTarget(applyTemplate("{origin}{path}", "http://127.0.0.1:18800/page.html?utm_source=newsletter"));
    assert.equal(stripped, "http://127.0.0.1:18800/page.html");
    assert.equal(safeRewriteTarget(applyTemplate("https://old.reddit.com{path}{query}", "https://www.reddit.com/r/x?sort=new")), "https://old.reddit.com/r/x?sort=new");
    assert.equal(safeRewriteTarget("https://example.com/zed"), "https://example.com/zed");
    assert.deepEqual(providerRows([{ title: "Zed", url: "https://example.com/zed" }]).map((r) => r.url), ["https://example.com/zed"]);
    const spec = parseMatchPattern("https://example.com/zed");
    assert.equal(matchesUrl(spec, "https://example.com/zed"), true);
    assert.equal(matchesUrl(parseMatchPattern("https://*.Example.com/*"), "https://A.example.com/x"), true);
    assert.equal(sameOrigin("https://a.example/x", "https://a.example:443/y"), true);
  });
});
