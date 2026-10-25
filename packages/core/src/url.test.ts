import assert from "node:assert/strict";
import { test } from "node:test";
import { PSL_TLDS } from "./publicSuffixes.ts";
import { domainToASCII } from "node:url";
import { cleanUrl } from "./cleanUrl.ts";
import { displayHost, hostSpoofReason, punycodeEncode } from "./idn.ts";
import { addressParts, breadcrumb, classifyPaste, fixupUrl, registrableDomain, resolveInput, stripJavascriptSchemes, urlForDisplay, withoutPastedJavascript } from "./omnibox.ts";
import { displayUrl } from "./suggest.ts";

test("resolveInput turns typed text into a URL", () => {
  assert.equal(resolveInput("apple.com"), "https://apple.com");
  assert.equal(resolveInput("localhost:3000"), "http://localhost:3000");
  assert.equal(resolveInput("192.168.1.1/admin"), "http://192.168.1.1/admin");
  assert.equal(resolveInput("https://x.com/home"), "https://x.com/home");
  assert.equal(resolveInput("about:blank"), "about:blank");
  assert.equal(resolveInput("how to cook rice"), "https://www.google.com/search?q=how%20to%20cook%20rice");
  assert.equal(resolveInput("react"), "https://www.google.com/search?q=react");
  assert.equal(resolveInput("   "), "");
});

test("fixupUrl: ports, IPv6, local names, schemes and file paths", () => {
  assert.equal(fixupUrl("example.com:8080/x"), "https://example.com:8080/x");
  assert.equal(fixupUrl("[::1]:8080"), "http://[::1]:8080");
  assert.equal(fixupUrl("printer.local"), "http://printer.local");
  assert.equal(fixupUrl("myapp.localhost:5173"), "http://myapp.localhost:5173");
  assert.equal(fixupUrl("HTTPS://Example.com/Path"), "https://Example.com/Path");
  assert.equal(fixupUrl("file:///Users/me/a.html"), "file:///Users/me/a.html");
  assert.equal(fixupUrl("/Users/me/My File.html"), "file:///Users/me/My%20File.html");
  assert.equal(fixupUrl("mailto:hi@example.com"), "mailto:hi@example.com");
  assert.equal(fixupUrl("xn--bcher-kva.example"), null);
  assert.equal(fixupUrl("bücher.de"), "https://bücher.de");
  assert.equal(fixupUrl("en.wikipedia.org/wiki/Cat"), "https://en.wikipedia.org/wiki/Cat");
  assert.equal(fixupUrl("github.io"), "https://github.io");
  assert.equal(fixupUrl("example.co.uk"), "https://example.co.uk");
});

test("fixupUrl leaves searches alone: file names, emails, prose, unknown schemes", () => {
  for (const text of ["index.html", "node.js", "hi@example.com", "what is apple.com", "note: buy milk", "c++", "javascript:alert(1)", "1.5", "e.g."]) {
    assert.equal(fixupUrl(text), null, text);
  }
  assert.equal(fixupUrl("docs.internal/setup"), "http://docs.internal/setup");
  assert.equal(fixupUrl("site.photography/about"), "https://site.photography/about");
});

const ascii = (unicode: string) => {
  const host = domainToASCII(unicode);
  assert.ok(host, `${unicode} should be a valid IDN`);
  return host;
};
const shown = (unicode: string) => displayHost(ascii(unicode));

test("mixing Latin with Cyrillic or Greek stays punycode", () => {
  assert.equal(shown("аpple.com"), "xn--pple-43d.com");
  assert.equal(hostSpoofReason(ascii("аpple.com")), "mixedScripts");
  assert.equal(hostSpoofReason(ascii("gοogle.net")), "mixedScripts");
  assert.equal(hostSpoofReason(ascii("пα.com")), "mixedScripts");
});

test("whole-script confusables stay punycode outside their TLDs", () => {
  assert.equal(shown("аррӏе.com"), "xn--80ak6aa92e.com");
  assert.equal(hostSpoofReason("xn--80ak6aa92e.com"), "wholeScriptConfusable");
  assert.equal(shown("аррӏе.ru"), "аррӏе.ru");
  assert.equal(shown("аррӏе.рф"), "аррӏе.рф");
  assert.equal(hostSpoofReason(ascii("ικα.com")), "wholeScriptConfusable");
  assert.equal(shown("ικα.gr"), "ικα.gr");
  assert.equal(hostSpoofReason(ascii("ოყ.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("ทน.com")), "wholeScriptConfusable");
  assert.equal(hostSpoofReason(ascii("օս.com")), "wholeScriptConfusable");
});

test("dangerous patterns", () => {
  assert.equal(hostSpoofReason(ascii("aノb.com")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("abcン.com")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("カヘカ.jp")), null);
  assert.equal(hostSpoofReason(ascii("カへカ.jp")), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("ーabc.jp")), "dangerousPattern");
  assert.equal(hostSpoofReason("xn--" + punycodeEncode("ai\u0307b") + ".com"), "dangerousPattern");
  assert.equal(hostSpoofReason(ascii("oհ.com")), "dangerousPattern");
});

test("cleanUrl drops campaign and click-id parameters", () => {
  assert.equal(
    cleanUrl("https://example.com/post?utm_source=newsletter&utm_medium=email&utm_campaign=fall"),
    "https://example.com/post",
  );
  assert.equal(cleanUrl("https://example.com/?fbclid=IwAR0abc"), "https://example.com/");
  assert.equal(cleanUrl("https://shop.example/item?id=42&gclid=Cj0KCQ&color=red"), "https://shop.example/item?id=42&color=red");
  assert.equal(cleanUrl("https://news.example/a?mc_eid=123&mc_cid=456&page=2"), "https://news.example/a?page=2");
  assert.equal(cleanUrl("https://x.example/?_hsenc=p2A&_hsmi=1&msclkid=9"), "https://x.example/");
  assert.equal(cleanUrl("https://example.com/?UTM_Source=caps"), "https://example.com/");
});

test("cleanUrl keeps the rest of the URL exactly as it was", () => {
  assert.equal(cleanUrl("https://example.com/a?q=a%20b&utm_source=x#section-2"), "https://example.com/a?q=a%20b#section-2");
  assert.equal(cleanUrl("https://example.com/a?utm_source=x#frag?utm_medium=y"), "https://example.com/a#frag?utm_medium=y");
  assert.equal(cleanUrl("https://example.com/search?q=utm_source"), "https://example.com/search?q=utm_source");
  assert.equal(cleanUrl("https://example.com/?b=2&a=1"), "https://example.com/?b=2&a=1");
  assert.equal(cleanUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(cleanUrl("https://user:pw@example.com:8443/p?utm_term=x&k"), "https://user:pw@example.com:8443/p?k");
});

test("displayed URLs say ardia://, never chrome://", () => {
  assert.equal(urlForDisplay("ardia://version/"), "ardia://version");
  assert.equal(urlForDisplay("chrome://version/"), "ardia://version");
  assert.equal(urlForDisplay("chrome://settings/languages"), "ardia://settings/languages");
  assert.equal(urlForDisplay("ardia://history/?q=a"), "ardia://history?q=a");
  assert.equal(displayUrl("chrome://gpu/"), "ardia://gpu");
  assert.deepEqual(breadcrumb("ardia://version/", "About Version"), { host: "ardia://version", trail: ["About Version"] });
  assert.deepEqual(breadcrumb("ardia://history", "History"), { host: "ardia://history", trail: [] });
  assert.deepEqual(breadcrumb("chrome://flags/", "Experiments"), { host: "ardia://flags", trail: ["Experiments"] });
});

test("a mixed-case host displays like its lowercase self, and the path never repeats it", () => {
  assert.equal(urlForDisplay("https://WWW.Example.com/x"), "example.com/x");
  assert.deepEqual(addressParts("https://WWW.Example.com/x"), { host: "example.com", domain: "example.com", rest: "/x" });
  assert.deepEqual(addressParts("https://WWW.Example.COM:8443/x"), { host: "example.com:8443", domain: "example.com:8443", rest: "/x" });
  assert.equal(urlForDisplay("https://WWW.Example.com"), "example.com");
});

test("host:port navigates: single-label intranet hosts over http, a number or a time never", () => {
  assert.equal(fixupUrl("myserver:8080"), "http://myserver:8080");
  assert.equal(fixupUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(fixupUrl("devbox:3000/api/health?x=1"), "http://devbox:3000/api/health?x=1");
  assert.equal(fixupUrl("foo.zzzz:8080"), "https://foo.zzzz:8080");
  assert.equal(resolveInput("myserver:8080"), "http://myserver:8080");
  for (const text of ["10:30", "3:2", "8080", "12:30pm", "ratio 3:2", "note: 5", "a:b", "std::vector"]) assert.equal(fixupUrl(text), null, text);
});

test("IDN hosts navigate, in any script, with or without a path", () => {
  assert.equal(fixupUrl("münchen.de"), "https://münchen.de");
  assert.equal(fixupUrl("Яндекс.рф"), "https://Яндекс.рф");
  assert.equal(fixupUrl("яндекс.рф/search?text=x"), "https://яндекс.рф/search?text=x");
  assert.equal(fixupUrl("例え.jp"), "https://例え.jp");
  assert.equal(fixupUrl("bücher.example/x/"), "https://bücher.example/x/");
  assert.equal(fixupUrl("xn--bcher-kva.de"), "https://xn--bcher-kva.de");
  assert.equal(fixupUrl("café.fr:8443"), "https://café.fr:8443");
  assert.equal(fixupUrl("café"), null);
  assert.equal(fixupUrl("münchen.zzzz"), null);
  assert.equal(fixupUrl("naïve bayes.com"), null);
});

test("an unknown TLD searches unless a port, a trailing slash or two of path, query and fragment say URL", () => {
  assert.equal(fixupUrl("foo.zzzz"), null);
  assert.equal(fixupUrl("foo.zzzz/x"), null);
  assert.equal(fixupUrl("foo.zzzz?x=1"), null);
  assert.equal(fixupUrl("foo.zzzz#top"), null);
  assert.equal(fixupUrl("foo.zzzz/"), "https://foo.zzzz/");
  assert.equal(fixupUrl("foo.zzzz/x/"), "https://foo.zzzz/x/");
  assert.equal(fixupUrl("foo.zzzz/x?y=1"), "https://foo.zzzz/x?y=1");
  assert.equal(fixupUrl("foo.zzzz/x#y"), "https://foo.zzzz/x#y");
  assert.equal(fixupUrl("x.y/"), "https://x.y/");
  assert.equal(fixupUrl("https://foo.zzzz/x"), "https://foo.zzzz/x");
  assert.equal(fixupUrl("http://foo"), "http://foo");
  assert.equal(fixupUrl("foo/bar"), null);
  assert.equal(fixupUrl("foo/"), "http://foo/");
  assert.equal(fixupUrl("wiki/Main?x=1"), "http://wiki/Main?x=1");
  assert.equal(fixupUrl("react"), null);
  assert.equal(fixupUrl("and/or"), null);
});

test("a known registry navigates with or without a path (Chrome's public suffix list)", () => {
  for (const text of ["site.photography/about", "docs.new", "report.zip", "shop.bike", "hello.world", "plans.web", "a.xn--p1ai", "b.中国", "c.рф"]) {
    assert.ok(fixupUrl(text), text);
  }
  for (const text of ["index.html", "node.js", "e.g.", "1.5", "a.b", "c++", "v1.2.3", "file.txt", "README.md.bak", "hi@example.com"]) {
    assert.equal(fixupUrl(text), null, text);
  }
});

test("random hosts: a known TLD or a port navigates, a bare unknown name or a space never does", () => {
  let seed = 7;
  const rnd = (n: number) => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed % n);
  const pick = <T,>(list: readonly T[]): T => list[rnd(list.length)]!;
  const tlds = PSL_TLDS.filter((t) => t.length > 1 && t !== "local" && t !== "localhost");
  const labels = ["a", "foo", "my-site", "x1", "münchen", "яндекс", "例え", "9lives", "a-b-c"];
  for (let i = 0; i < 3000; i++) {
    const host = `${pick(labels)}${rnd(3) ? "" : `.${pick(labels)}`}.${pick(tlds)}`;
    const tail = pick(["", "/", "/x", "/x/y?z=1", ":8080", ":8080/x", "?q=1", "#t"]);
    const url = fixupUrl(host + tail);
    assert.ok(url?.endsWith(host + tail), `${host}${tail} → ${url}`);
    assert.equal(fixupUrl(`${host} ${tail}`.trimEnd() + " x"), null, "a space makes it prose");
    const unknown = `${pick(labels)}.${pick(["zzzz", "qqqq", "notatld"])}`;
    const bare = fixupUrl(unknown + pick(["", "/x", "?q=1", "#t"]));
    assert.equal(bare, null, unknown);
    assert.ok(fixupUrl(`${unknown}:${1 + rnd(65535)}`), "a port makes it a URL");
  }
});

test("stripJavascriptSchemes works like Chrome's StripJavascriptSchemas", () => {
  assert.equal(stripJavascriptSchemes("javascript:alert(1)"), "alert(1)");
  assert.equal(stripJavascriptSchemes("  javascript:javascript:alert(1)"), "alert(1)");
  assert.equal(stripJavascriptSchemes("\u0001JaVaScRiPt: \u0000\tjavascript:\n x"), "x");
  assert.equal(stripJavascriptSchemes("  javascript://%0Aalert(1)"), "//%0Aalert(1)");
  for (const text of ["  hello", "java script:x", "https://example.com/javascript:x", "javascript tutorial", "%6Aavascript:x", ""]) {
    assert.equal(stripJavascriptSchemes(text), text, text);
  }
});

test("pasted javascript: URLs never navigate", () => {
  assert.deepEqual(classifyPaste("javascript://x%0Aalert(1)"), { kind: "search", query: "//x%0Aalert(1)" });
  assert.deepEqual(classifyPaste("javascript:alert(document.domain)"), { kind: "search", query: "alert(document.domain)" });
  assert.deepEqual(classifyPaste("\n JAVASCRIPT:javascript:\u0001https://example.com/a"), { kind: "go", url: "https://example.com/a" });
  assert.equal(classifyPaste("javascript:"), null);
  assert.equal(classifyPaste(" \u0000javascript: javascript:\t"), null);
  assert.deepEqual(classifyPaste("javascript tutorial"), { kind: "search", query: "javascript tutorial" });
  assert.deepEqual(classifyPaste("https://example.com/javascript:x"), { kind: "go", url: "https://example.com/javascript:x" });
  const lures = ["javascript://%0Adocument.title=1", "JaVaScRiPt://x", "\tjavascript://x", "\u0001javascript://x", "javascript:javascript://x", "javascript:%0Aalert(1)"];
  for (const text of lures) {
    const action = classifyPaste(text);
    assert.ok(!action || action.kind === "search" || !/javascript:/i.test(action.url), text);
  }
});

test("a javascript: URL pasted into the field loses its scheme; one typed key by key keeps it", () => {
  assert.equal(withoutPastedJavascript("", "javascript://x%0Aalert(1)"), "//x%0Aalert(1)");
  assert.equal(withoutPastedJavascript("https://www.facebook.com/some/long/page", "javascript:alert(1)"), "alert(1)");
  assert.equal(withoutPastedJavascript("javascript", "javascript:x"), "x");
  let typed = "";
  for (const key of "javascript://x%0Aalert(1)") typed = withoutPastedJavascript(typed, typed + key);
  assert.equal(typed, "javascript://x%0Aalert(1)");
  assert.equal(withoutPastedJavascript("javascript tutorial", "javascript:"), "javascript:");
  assert.equal(withoutPastedJavascript("javascript:alert(1)", "javascript:alert(12)"), "javascript:alert(12)");
  assert.equal(withoutPastedJavascript("hello", "hello world"), "hello world");
});

test("pasting over a selection measures the pasted text, not how little the field changed", () => {
  const before = "javascript:alert(1)";
  assert.equal(withoutPastedJavascript(before, "javascript:alert(2)", { start: 0, end: before.length }), "alert(2)");
  assert.equal(withoutPastedJavascript(before, "javascript:alert(2)", { start: before.length, end: 0 }), "alert(2)");
  assert.equal(withoutPastedJavascript(before, "javascript:alert(2)", { start: 17, end: 18 }), "javascript:alert(2)");
  assert.equal(withoutPastedJavascript("java", "javascript://x%0Aalert(1)", { start: 4, end: 4 }), "//x%0Aalert(1)");
  assert.equal(withoutPastedJavascript("javascript:alert(1", "javascript:alert(1)", { start: 18, end: 18 }), "javascript:alert(1)");
  assert.equal(withoutPastedJavascript(before, "javascript:alert(2)", { start: 40, end: 50 }), "javascript:alert(2)");
});

test("registrableDomain follows the public suffix list with private registries counted, as Chrome's URL display does", () => {
  const cases: [string, string][] = [
    ["accounts.google.com", "google.com"],
    ["accounts.google.com.secure-login.example", "secure-login.example"],
    ["not-really-paypal.com", "not-really-paypal.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["shop.example.com.au", "example.com.au"],
    ["user.github.io", "user.github.io"],
    ["evil-paypal.github.io", "evil-paypal.github.io"],
    ["upload.wontfix.pages.dev", "wontfix.pages.dev"],
    ["x.vercel.app", "x.vercel.app"],
    ["foo.pages.dev", "foo.pages.dev"],
    ["example.github.io", "example.github.io"],
    ["a.b.kawasaki.jp", "a.b.kawasaki.jp"],
    ["x.city.kawasaki.jp", "city.kawasaki.jp"],
    ["x.www.ck", "www.ck"],
    ["www.ck", "www.ck"],
    ["x.y.ck", "x.y.ck"],
    ["mail.example.公司.cn", "example.公司.cn"],
    ["mail.example.xn--55qx5d.cn", "example.xn--55qx5d.cn"],
    ["example.com.", "example.com."],
    ["co.uk", ""],
    ["com", ""],
    ["localhost", ""],
    ["192.168.1.1", ""],
    ["[::1]", ""],
  ];
  for (const [host, domain] of cases) assert.equal(registrableDomain(host), domain, host);
});

test("addressParts keeps the registrable domain whole and leaves URLs without a host as they are", () => {
  assert.deepEqual(addressParts("https://accounts.google.com.evil-login.com/x"), { host: "accounts.google.com.evil-login.com", domain: "evil-login.com", rest: "/x" });
  assert.deepEqual(addressParts("https://not-really-paypal.com/"), { host: "not-really-paypal.com", domain: "not-really-paypal.com", rest: "/" });
  assert.deepEqual(addressParts("https://user:pw@login.example.co.uk:8443/a"), { host: "login.example.co.uk:8443", domain: "example.co.uk:8443", rest: "/a" });
  assert.deepEqual(addressParts("https://www.example.com/"), { host: "example.com", domain: "example.com", rest: "/" });
  assert.deepEqual(addressParts("http://192.168.1.1:8080/admin"), { host: "192.168.1.1:8080", domain: "192.168.1.1:8080", rest: "/admin" });
  assert.deepEqual(addressParts("file:///Users/me/My%20File.html"), { host: "File", domain: "File", rest: " /Users/me/My File.html" });
  assert.deepEqual(addressParts("ardia://settings/languages"), { host: "ardia://settings", domain: "ardia://settings", rest: "/languages" });
  assert.deepEqual(addressParts("https://example.com:443/x"), { host: "example.com", domain: "example.com", rest: "/x" });
  assert.deepEqual(addressParts("http://example.com:80/x"), { host: "example.com", domain: "example.com", rest: "/x" });
  assert.deepEqual(addressParts("http://[::1]:80/x"), { host: "[::1]", domain: "[::1]", rest: "/x" });
  assert.deepEqual(addressParts("https://example.com:8443/x"), { host: "example.com:8443", domain: "example.com:8443", rest: "/x" });
  assert.deepEqual(addressParts("http://[::1]:8080/x"), { host: "[::1]:8080", domain: "[::1]:8080", rest: "/x" });
  for (const url of ["data:text/html,<p>" + "x".repeat(300), "blob:https://evil.com/0b3c6f5e-8d1a-4c1e-9a7b-2f4d", "about:blank"]) {
    assert.deepEqual(addressParts(url), { host: url, domain: url, rest: "" }, url);
  }
  assert.deepEqual(addressParts("https://a.b.c.example.co.uk/"), { host: "a.b.c.example.co.uk", domain: "example.co.uk", rest: "/" });
  assert.deepEqual(addressParts("https://x.city.kawasaki.jp/"), { host: "x.city.kawasaki.jp", domain: "city.kawasaki.jp", rest: "/" });
  assert.deepEqual(addressParts("http://[::1]:8080/"), { host: "[::1]:8080", domain: "[::1]:8080", rest: "/" });
  assert.deepEqual(addressParts("https://xn--bcher-kva.de:81/x"), { host: "bücher.de:81", domain: "bücher.de:81", rest: "/x" });
  assert.deepEqual(addressParts("https://www.ck/"), { host: "www.ck", domain: "www.ck", rest: "/" });
  assert.deepEqual(addressParts("https://evil-paypal.github.io/a"), { host: "evil-paypal.github.io", domain: "evil-paypal.github.io", rest: "/a" });
});

test("displayed URLs never show a username or password", () => {
  assert.equal(urlForDisplay("https://user:secret@example.com/x"), "example.com/x");
  assert.equal(urlForDisplay("https://user@www.example.com/"), "example.com/");
  assert.equal(urlForDisplay("https://a@b@evil.com/x@y"), "evil.com/x@y");
  assert.equal(urlForDisplay("https://accounts.google.com@evil.com/"), "evil.com/");
  assert.equal(urlForDisplay("mailto:hi@example.com"), "mailto:hi@example.com");
  assert.equal(breadcrumb("https://user:secret@example.com/x").host, "example.com");
  assert.equal(breadcrumb("https://a@b@evil.com/").host, "evil.com");
});

test("a non-default port is part of the displayed host", () => {
  assert.equal(breadcrumb("https://example.com:8443/x").host, "example.com:8443");
  assert.equal(breadcrumb("http://localhost:3000/").host, "localhost:3000");
  assert.equal(breadcrumb("http://[::1]:8080/").host, "[::1]:8080");
  assert.equal(breadcrumb("https://user:pw@www.example.com:8443/").host, "example.com:8443");
  assert.equal(breadcrumb("https://example.com:443/").host, "example.com");
  assert.equal(breadcrumb("http://example.com:80/").host, "example.com");
  assert.equal(breadcrumb("https://example.com/").host, "example.com");
  for (const url of ["https://example.com:8443/x", "https://user:pw@example.com:8443/a?b", "http://[::1]:8080/", "https://www.example.com/", "https://xn--bcher-kva.de:81/"]) {
    assert.ok(urlForDisplay(url).startsWith(breadcrumb(url).host), url);
  }
});
