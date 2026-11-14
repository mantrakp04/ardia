import assert from "node:assert/strict";
import { test } from "node:test";
import { faviconCandidates, firstUsable, monogram, monogramHash, monogramHost, monogramLetter, monogramTint, tileGradient, usableLook } from "./favicon.ts";

test("a page's own icon comes first, then the site's favicon.ico", () => {
  assert.deepEqual(faviconCandidates("https://cdn.example.com/icon.png", "https://www.example.com/a/b?c=1"), [
    "https://cdn.example.com/icon.png",
    "https://www.example.com/favicon.ico",
  ]);
  assert.deepEqual(faviconCandidates("https://example.com/favicon.ico", "https://example.com/page"), ["https://example.com/favicon.ico"]);
});

test("a history row with no icon, like one synced from the Mac, still tries the site's favicon.ico", () => {
  assert.deepEqual(faviconCandidates(null, "https://news.ycombinator.com/item?id=1"), ["https://news.ycombinator.com/favicon.ico"]);
  assert.deepEqual(faviconCandidates(null, "http://example.com:8080/x"), ["http://example.com:8080/favicon.ico"]);
});

test("only web addresses are tried", () => {
  assert.deepEqual(faviconCandidates("data:image/png;base64,AAAA", "about:blank"), []);
  assert.deepEqual(faviconCandidates(null, null), []);
  assert.deepEqual(faviconCandidates("ftp://example.com/icon.png", "file:///tmp/a.html"), []);
});

test("the letter tile uses the host without www", () => {
  assert.equal(monogramHost("https://www.GitHub.com/ardia"), "github.com");
  assert.equal(monogramHost("https://user:pass@mail.example.org:443/"), "mail.example.org");
  assert.equal(monogramHost("not a url"), null);
  assert.equal(monogramHost(""), null);
  assert.equal(monogramLetter("github.com"), "G");
  assert.equal(monogramLetter("-9gag.com"), "9");
  assert.equal(monogramLetter("ëlan.fr"), "Ë");
  assert.equal(monogramLetter("---"), null);
  assert.equal(monogramLetter(null), null);
});

test("the letter tile's colour comes from the same hash as the Compose and SwiftUI apps", () => {
  assert.equal(monogramHash(""), 5381);
  assert.equal(monogramHash("a"), 177670);
  assert.equal(monogramHash("github.com"), 141140373);
  assert.equal(monogramTint("github.com"), "#C2477A");
  assert.equal(monogramTint(null), "#8E8E93");
  assert.deepEqual(tileGradient("#000000"), ["#1A1A1A", "#000000"]);
  assert.deepEqual(monogram("https://www.github.com"), { letter: "G", colors: tileGradient("#C2477A") });
  assert.deepEqual(monogram(null), { letter: null, colors: tileGradient("#8E8E93") });
});

test("the first candidate that decodes to a visible icon wins, with the backing the module chose", async () => {
  const looks: Record<string, Awaited<Parameters<typeof usableLook>[0]>> = {
    "https://a.example/icon.png": { tone: "blank", backing: null },
    "https://a.example/favicon.ico": { tone: "darkOnClear", backing: "light" },
  };
  const look = async (url: string) => looks[url] ?? null;
  assert.deepEqual(await firstUsable(["https://a.example/icon.png", "https://a.example/favicon.ico"], look), { url: "https://a.example/favicon.ico", backing: "light" });
  assert.equal(await firstUsable(["https://a.example/icon.png", "https://b.example/x.png"], look), null);
  assert.equal(await firstUsable(["https://c.example/x.png"], async () => { throw new Error("offline"); }), null);
  assert.equal(usableLook({ tone: "opaque", backing: null }), true);
  assert.equal(usableLook(null), false);
});
