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
  assert.equal(formatUrl(urlParts("HTTPS://Example.COM/a?b=1#c")), "https://example.com/a?b=1#c");
  assert.equal(formatUrl(urlParts("HTTPS://Example.COM:443/a")), "https://example.com/a");
  assert.equal(formatUrl(urlParts("http://example.com:80/a")), "http://example.com/a");
  assert.equal(formatUrl(urlParts("https://example.com:80/a")), "https://example.com:80/a");
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
    assert.equal(sameOrigin("https://a.example/x", "https://A.example/y"), true);
  });
});

test("anything urlParts can't read the way Chromium does fails closed: no match, no rewrite, no same origin", async () => {
  const { decideOpening } = await import("../state/automation/decisions.ts");
  const { setHooksForTests } = await import("../state/automation/hookRules.ts");
  const { parseHooksDocument } = await import("../state/automation/hookFile.ts");
  const ambiguous = [
    "https://evil.example\\@bank.example/pay?tracking=1",
    "https://evil.example\\bank.example/pay",
    "https://user@bank.example/pay",
    "https://%62ank.example/pay",
    "https://127.1/pay",
    "https://0177.0.0.1/pay",
    "https://0x7f.0.0.1/pay",
    "https://2130706433/pay",
    "https://1.2.3.04/pay",
    "https://[0:0:0:0:0:0:0:1]/pay",
    "https://[::FFFF:1]/pay",
    "https://bank.example:0443/pay",
    "https://bank.example:0/pay",
    "https://bank.example:65536/pay",
    "https://bank.example:/pay",
    "https://bank .example/pay",
    "https://bank.example/pa\ty",
  ];
  for (const href of ambiguous) assert.equal(urlParts(href), null, href);
  for (const href of ["https://127.0.0.1/x", "https://[::1]/x", "https://[2001:db8::1]/x", "https://xn--bnk-sna.example/x", "https://bank.example:8443/x"]) assert.ok(urlParts(href), href);
  setHooksForTests(parseHooksDocument({ hooks: [{ name: "strip", on: "tab.opening", match: "https://bank.example/*", rewrite: [{ match: "https://bank.example/*", to: "{origin}{path}" }] }] }).hooks);
  const context = { tabId: null, windowId: null, profileId: null, via: "typed" };
  assert.equal(decideOpening("https://evil.example\\@bank.example/pay?tracking=1", context), null);
  assert.equal(decideOpening("https://user@bank.example/pay?tracking=1", context), null);
  assert.deepEqual(decideOpening("https://bank.example/pay?tracking=1", context), { url: "https://bank.example/pay" });
  assert.equal(sameOrigin("https://evil.example\\@bank.example/", "https://bank.example/"), false);
  assert.equal(matchesUrl(parseMatchPattern("https://bank.example/*"), "https://evil.example\\@bank.example/pay"), false);
  setHooksForTests([]);
});

test("IDN hosts become punycode; anything ambiguous still fails closed", () => {
  assert.equal(formatUrl(urlParts("https://bücher.de/x")), "https://xn--bcher-kva.de/x");
  assert.equal(formatUrl(urlParts("https://BÜCHER.de/x")), "https://xn--bcher-kva.de/x");
  assert.equal(formatUrl(urlParts("https://xn--bcher-kva.de/x")), "https://xn--bcher-kva.de/x");
  assert.equal(matchesUrl(parseMatchPattern("https://bücher.de/*"), "https://xn--bcher-kva.de/x"), true);
  assert.equal(matchesUrl(parseMatchPattern("https://*.xn--bcher-kva.de/*"), "https://shop.bücher.de/x"), true);
  assert.equal(sameOrigin("https://bücher.de/a", "https://xn--bcher-kva.de/b"), true);
  for (const href of ["https://straße.de/", "https://bücher。de/", "https://ｂücher.de/", "https://bü cher.de/", "https://bü%63her.de/", "https://аррӏе.com/", "https://evil.example\\@bücher.de/", "https://u@bücher.de/"])
    assert.equal(urlParts(href), null, href);
});
