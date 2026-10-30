import assert from "node:assert/strict";
import { test } from "node:test";
const { SHARE_PREFIX, boostCodeFromLink, decodeBoost, encodeBoost, shareLink } = await import("./share.ts");

const boost = (patch = {}) => ({
  id: "b1",
  name: "Night paper",
  author: "Logan",
  domain: "example.com",
  subdomains: true,
  enabled: false,
  colors: { hue: 210, saturation: 0.6, offset: 30, invert: true, originalSaturation: 0.5, contrast: 0.4, brightness: -0.25, appearance: "dark" },
  font: "Charter",
  size: 110,
  textCase: "title",
  zaps: [".ad-banner", "#cookie-wall"],
  css: "body { max-width: 40em; margin: 0 auto; }\n".repeat(20),
  js: "",
  modified: 123,
  ...patch,
});

const codeFor = async (data) => {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const literal = [];
  for (let i = 0; i < bytes.length; i += 128) {
    const run = bytes.subarray(i, i + 128);
    literal.push(run.length - 1, ...run);
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let text = "";
  for (let i = 0; i < literal.length; i += 3) {
    const chunk = (literal[i] << 16) | ((literal[i + 1] ?? 0) << 8) | (literal[i + 2] ?? 0);
    const chars = Math.min(4, literal.length - i + 1);
    for (let k = 0; k < chars; k++) text += alphabet[(chunk >> (18 - 6 * k)) & 63];
  }
  return SHARE_PREFIX + text;
};

const shared = (patch = {}) => {
  const { id, enabled, js, modified, ...rest } = boost();
  return { ...rest, ...patch };
};

test("a boost survives the round trip without its id, enabled flag or modified time", () => {
  const original = boost();
  const code = encodeBoost(original);
  assert.ok(code.startsWith("ardia-boost:1:"));
  const decoded = decodeBoost(code);
  assert.equal(decoded.error, undefined);
  const { id, enabled, js, modified, ...kept } = original;
  const { id: _i, enabled: _e, js: _j, modified: _m, ...got } = decoded;
  assert.deepEqual(got, kept);
  assert.equal(decoded.js, "");
});

test("a boost with no colours, font or zaps round-trips", () => {
  const original = boost({ colors: null, font: null, zaps: [], css: "", size: 100, textCase: "none", author: "", subdomains: false });
  const decoded = decodeBoost(encodeBoost(original));
  assert.equal(decoded.colors, null);
  assert.equal(decoded.font, null);
  assert.deepEqual(decoded.zaps, []);
  assert.equal(decoded.author, "");
});

test("repeated css gets smaller", () => {
  const big = boost({ css: "a { color: red; }\n".repeat(500) });
  assert.ok(encodeBoost(big).length < big.css.length / 10);
});

test("random text round-trips through the compressor", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let n = 0; n < 40; n++) {
    const words = Array.from({ length: next() % 400 }, () => ["div", "span", "é", "😀", ".a-b", "{", "}", String(next() % 50)][next() % 8]);
    const css = words.join(next() % 2 ? " " : "");
    const decoded = decodeBoost(encodeBoost(boost({ css })));
    assert.equal(decoded.css, css);
  }
});

test("a boost with JavaScript can't be shared", () => {
  assert.equal(encodeBoost(boost({ js: "alert(1)" })), null);
});

test("the share link carries the code in the fragment", () => {
  const code = encodeBoost(boost());
  assert.equal(shareLink(code), `https://ardia.dev/boost#${code}`);
  assert.equal(boostCodeFromLink(shareLink(code)), code);
  assert.equal(boostCodeFromLink("https://ardia.dev/arc"), null);
  assert.equal(decodeBoost(shareLink(code)).name, "Night paper");
  assert.equal(decodeBoost(`  ${code.slice(0, 20)}\n${code.slice(20)} `).name, "Night paper");
});

test("bad codes give a plain error and never throw", () => {
  const code = encodeBoost(boost());
  const bad = [
    "",
    "   ",
    "hello",
    "ardia-boost:",
    "ardia-boost:1:",
    "ardia-boost:1:!!!!",
    "ardia-boost:1:A",
    "ardia-boost:2:" + code.slice(SHARE_PREFIX.length),
    "ardia-boost:x:abcd",
    code.slice(0, code.length - 10),
    code.slice(0, 30) + "A" + code.slice(31),
    code + "AAAA",
    "ardia-boost:1:" + "A".repeat(400),
    "ardia-boost:1:" + "_".repeat(200_000),
    "setup1-abc",
  ];
  for (const text of bad) {
    const result = decodeBoost(text);
    assert.equal(typeof result.error, "string", JSON.stringify(text));
    assert.ok(result.error.length > 0);
  }
});

test("a newer version asks for an update", () => {
  assert.match(decodeBoost("ardia-boost:2:abcd").error, /newer Ardia/);
});

test("a code that expands past the cap is refused", async () => {
  const bomb = [0, 0x41, ...Array.from({ length: 5000 }, () => [0xff, 0, 1]).flat()];
  let text = "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < bomb.length; i += 3) {
    const chunk = (bomb[i] << 16) | ((bomb[i + 1] ?? 0) << 8) | (bomb[i + 2] ?? 0);
    const chars = Math.min(4, bomb.length - i + 1);
    for (let k = 0; k < chars; k++) text += alphabet[(chunk >> (18 - 6 * k)) & 63];
  }
  assert.ok(decodeBoost(SHARE_PREFIX + text).error);
});

test("a js field is never accepted", async () => {
  assert.match(decodeBoost(await codeFor(shared({ js: "alert(1)" }))).error, /JavaScript/);
  assert.match(decodeBoost(await codeFor(shared({ js: "" }))).error, /JavaScript/);
});

test("every field is checked", async () => {
  const cases = [
    { name: 5 },
    { name: "x".repeat(101) },
    { name: "a\nb" },
    { author: null },
    { domain: "Example.com" },
    { domain: "exa mple.com" },
    { domain: "" },
    { domain: "a".repeat(260) + ".com" },
    { domain: "https://example.com" },
    { subdomains: "yes" },
    { colors: undefined },
    { colors: {} },
    { colors: { ...shared().colors, hue: 400 } },
    { colors: { ...shared().colors, saturation: -0.1 } },
    { colors: { ...shared().colors, brightness: 2 } },
    { colors: { ...shared().colors, contrast: "1" } },
    { colors: { ...shared().colors, invert: 1 } },
    { colors: { ...shared().colors, appearance: "auto" } },
    { colors: { ...shared().colors, extra: 1 } },
    { colors: [] },
    { font: "Comic Sans" },
    { font: 5 },
    { size: 120 },
    { size: "110" },
    { textCase: "shout" },
    { zaps: "a" },
    { zaps: [5] },
    { zaps: [""] },
    { zaps: ["x".repeat(501)] },
    { zaps: Array.from({ length: 101 }, (_, i) => `.z${i}`) },
    { css: 5 },
    { css: "a".repeat(50_001) },
    { extra: true },
    { id: "b1" },
    { enabled: true },
    { modified: 1 },
  ];
  for (const patch of cases) {
    const data = shared(patch);
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete data[key];
    const result = decodeBoost(await codeFor(data));
    assert.equal(typeof result.error, "string", JSON.stringify(patch).slice(0, 80));
  }
});

test("a missing field is refused", async () => {
  const data = shared();
  delete data.css;
  assert.ok(decodeBoost(await codeFor(data)).error);
});

test("non-object json is refused", async () => {
  for (const data of [null, [], 5, "x"]) assert.ok(decodeBoost(await codeFor(data)).error);
});

test("limits are inclusive", async () => {
  const edge = shared({ name: "x".repeat(100), css: "a".repeat(50_000), zaps: Array.from({ length: 100 }, (_, i) => `.z${i}`), colors: { ...shared().colors, hue: 360, brightness: 1, offset: -360 } });
  assert.equal(decodeBoost(await codeFor(edge)).error, undefined);
});

test("css that loads from the web and selectors that escape their rule are refused", async () => {
  for (const css of ["@import 'https://evil.test/x.css';", "a{background:url(https://evil.test/x.png)}", "a{background:URL( http://x )}"]) {
    assert.match(decodeBoost(await codeFor(shared({ css }))).error, /web/);
  }
  assert.equal(decodeBoost(await codeFor(shared({ css: "a{background:url(data:image/png;base64,AAAA)}" }))).error, undefined);
  for (const css of ["a{background:u\\72l(https://evil.test/a)}", "@\\69mport 'x';", 'a{background:image-set("https://evil.test/a" 1x)}', 'a{background:image("https://evil.test/a")}']) {
    assert.match(decodeBoost(await codeFor(shared({ css }))).error, /web/);
  }
  for (const zap of [".a{}body{display:none}", ".a;b", "@media x", ".a/*", ".a\\"]) {
    assert.match(decodeBoost(await codeFor(shared({ zaps: [zap] }))).error, /hidden elements/);
  }
});

test("a selector the picker escaped is accepted", async () => {
  assert.equal(decodeBoost(await codeFor(shared({ zaps: [".post\\:card"] }))).error, undefined);
});

test("a boost the decoder would refuse is not shared", () => {
  assert.equal(encodeBoost(boost({ css: "a{background:url(https://example.com/bg.png)}" })), null);
  assert.equal(encodeBoost(boost({ name: "x".repeat(101) })), null);
});
