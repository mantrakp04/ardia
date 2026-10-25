import assert from "node:assert/strict";
import { test } from "node:test";
const { originForDisplay } = await import("./origin.ts");

test("https drops its scheme, every other scheme keeps it", () => {
  assert.equal(originForDisplay("https://bank.example/"), "bank.example");
  assert.equal(originForDisplay("https://bank.example"), "bank.example");
  assert.equal(originForDisplay("http://bank.example/"), "http://bank.example");
  assert.equal(originForDisplay("chrome-extension://abcdefghijklmnop/"), "chrome-extension://abcdefghijklmnop");
  assert.equal(originForDisplay("HTTPS://Bank.EXAMPLE/"), "bank.example");
});

test("the scheme's default port and port 0 are dropped, any other port is kept", () => {
  assert.equal(originForDisplay("https://bank.example:443/"), "bank.example");
  assert.equal(originForDisplay("http://bank.example:80/"), "http://bank.example");
  assert.equal(originForDisplay("http://bank.example:8080/"), "http://bank.example:8080");
  assert.equal(originForDisplay("https://bank.example:8443/"), "bank.example:8443");
  assert.equal(originForDisplay("https://bank.example:80/"), "bank.example:80");
  assert.equal(originForDisplay("http://bank.example:443/"), "http://bank.example:443");
  assert.equal(originForDisplay("http://bank.example:0/"), "http://bank.example");
  assert.equal(originForDisplay("http://bank.example:080/"), "http://bank.example");
});

test("IPv6 hosts keep their brackets and their port", () => {
  assert.equal(originForDisplay("http://[::1]:3000/"), "http://[::1]:3000");
  assert.equal(originForDisplay("https://[2001:db8::1]/"), "[2001:db8::1]");
  assert.equal(originForDisplay("https://[2001:db8::1]:443/"), "[2001:db8::1]");
});

test("xn-- hosts show Unicode only when it can't pass for another site", () => {
  assert.equal(originForDisplay("https://xn--mnchen-3ya.de/"), "münchen.de");
  assert.equal(originForDisplay("https://xn--pple-43d.com/"), "xn--pple-43d.com");
});

test("userinfo never shows, and the host after the last @ does", () => {
  assert.equal(originForDisplay("https://user:pass@bank.example:8443/"), "bank.example:8443");
  assert.equal(originForDisplay("https://bank.example@evil.example/"), "evil.example");
  assert.equal(originForDisplay("https://bank.example@x@evil.example/"), "evil.example");
  assert.equal(originForDisplay("https://evil.example/@bank.example"), "evil.example");
});

test("anything without a scheme and host comes back unchanged", () => {
  assert.equal(originForDisplay("null"), "null");
  assert.equal(originForDisplay("file:///"), "file:///");
  assert.equal(originForDisplay(""), "");
});
