import assert from "node:assert/strict";
import { test } from "node:test";
import { bestItem, isSecureOrigin, loginSavedIn, matchTier, rankItems, registrableDomain, sameSite, searchItems, TIER } from "./originMatch.ts";

const item = (id, urls, extra = {}) => ({ provider: "bitwarden", id, title: id, username: `${id}@example.com`, urls, hasTotp: false, ...extra });

test("an insecure page never matches, even against its own exact host", () => {
  assert.equal(isSecureOrigin("http://example.com"), false);
  assert.equal(matchTier("http://example.com", "http://example.com"), TIER.none);
  assert.equal(matchTier("http://example.com", "https://example.com"), TIER.none);
  assert.deepEqual(rankItems([item("a", ["example.com"])], "http://example.com"), []);
});

test("localhost and 127.0.0.1 match over plain http", () => {
  assert.equal(isSecureOrigin("http://localhost:3000"), true);
  assert.equal(matchTier("http://localhost:3000", "http://localhost:3000"), TIER.exact);
  assert.equal(matchTier("http://127.0.0.1:8080", "http://127.0.0.1:8080/login"), TIER.exact);
  assert.equal(matchTier("http://localhost:3000", "localhost"), TIER.exact);
});

test("a port saved with the item has to be the page's port", () => {
  assert.equal(matchTier("https://example.com:8443", "https://example.com"), TIER.none);
  assert.equal(matchTier("https://example.com", "https://example.com:8443"), TIER.none);
  assert.equal(matchTier("https://example.com:8443", "https://example.com:8443/app"), TIER.exact);
  assert.equal(matchTier("https://example.com", "https://example.com:443"), TIER.exact);
  assert.equal(matchTier("http://localhost:3000", "http://localhost:4000"), TIER.none);
});

test("other sites, look-alikes and suffix tricks never match", () => {
  assert.equal(matchTier("https://example.com", "https://example.org"), TIER.none);
  assert.equal(matchTier("https://notexample.com", "https://example.com"), TIER.none);
  assert.equal(matchTier("https://example.com.evil.net", "https://example.com"), TIER.none);
  assert.equal(matchTier("https://alice.github.io", "https://bob.github.io"), TIER.none);
  assert.equal(matchTier("https://alice.github.io", "https://github.io"), TIER.none);
  assert.equal(matchTier("https://shop.co.uk", "https://co.uk"), TIER.none);
  assert.equal(matchTier("https://a.co.uk", "https://b.co.uk"), TIER.none);
  assert.equal(matchTier("https://10.0.0.2", "https://10.0.0.1"), TIER.none);
  assert.equal(matchTier("https://example.com", "androidapp://com.example"), TIER.none);
  assert.equal(matchTier("https://example.com", ""), TIER.none);
});

test("exact host beats subdomain beats a sibling on the same site", () => {
  assert.equal(matchTier("https://example.com", "https://example.com/login"), TIER.exact);
  assert.equal(matchTier("https://login.example.com", "example.com"), TIER.subdomain);
  assert.equal(matchTier("https://example.com", "https://accounts.example.com"), TIER.subdomain);
  assert.equal(matchTier("https://app.example.com", "https://login.example.com"), TIER.sibling);
  assert.equal(matchTier("https://app.example.co.uk", "https://login.example.co.uk"), TIER.sibling);
  const ranked = rankItems([item("sibling", ["https://login.example.com"]), item("parent", ["example.com"]), item("exact", ["https://app.example.com"])], "https://app.example.com");
  assert.deepEqual(ranked.map((r) => r.item.id), ["exact", "parent", "sibling"]);
});

test("www is the same host as the bare domain", () => {
  assert.equal(matchTier("https://www.example.com", "https://example.com"), TIER.exact);
  assert.equal(matchTier("https://example.com", "www.example.com"), TIER.exact);
});

test("a saved http address still matches its https page, and hosts compare case-insensitively", () => {
  assert.equal(matchTier("https://example.com", "http://EXAMPLE.com/"), TIER.exact);
  assert.equal(matchTier("https://Example.COM", "example.com."), TIER.exact);
});

test("unicode hosts match their punycode origin", () => {
  assert.equal(matchTier("https://xn--bcher-kva.de", "https://bücher.de/login"), TIER.exact);
  assert.equal(registrableDomain("shop.bücher.de"), "xn--bcher-kva.de");
});

test("ties go to favourites, then the most recently changed, then the title", () => {
  const ranked = rankItems(
    [item("b", ["example.com"], { updatedAt: 1 }), item("a", ["example.com"], { updatedAt: 1 }), item("new", ["example.com"], { updatedAt: 9 }), item("fav", ["example.com"], { favorite: true })],
    "https://example.com",
  );
  assert.deepEqual(ranked.map((r) => r.item.id), ["fav", "new", "a", "b"]);
});

test("the best match for copying never falls back to a sibling", () => {
  assert.equal(bestItem([item("sibling", ["https://login.example.com"])], "https://app.example.com"), null);
  assert.equal(bestItem([item("sibling", ["https://login.example.com"]), item("own", ["example.com"])], "https://app.example.com")?.id, "own");
});

test("a login counts as saved only for the same site and the same username, ignoring case", () => {
  const items = [item("x", ["https://example.com"], { username: "Me@Example.com" })];
  assert.equal(loginSavedIn(items, "https://example.com", "me@example.com"), true);
  assert.equal(loginSavedIn(items, "https://login.example.com", " ME@EXAMPLE.COM "), true);
  assert.equal(loginSavedIn(items, "https://example.com", "other@example.com"), false);
  assert.equal(loginSavedIn(items, "https://example.org", "me@example.com"), false);
  assert.equal(loginSavedIn(items, "https://app.example.com", "me@example.com"), true);
  assert.equal(loginSavedIn([item("y", ["https://login.example.com"], { username: "me" })], "https://app.example.com", "me"), false);
  assert.equal(loginSavedIn([], "https://example.com", ""), false);
});

test("search finds items by title, username or host, every word required", () => {
  const items = [item("GitHub", ["https://github.com"], { username: "octo" }), item("Work Mail", ["https://mail.corp.example"], { username: "me" }), item("Bank", ["bank.example"])];
  assert.deepEqual(searchItems(items, "git").map((i) => i.title), ["GitHub"]);
  assert.deepEqual(searchItems(items, "octo").map((i) => i.title), ["GitHub"]);
  assert.deepEqual(searchItems(items, "corp").map((i) => i.title), ["Work Mail"]);
  assert.deepEqual(searchItems(items, "work me").map((i) => i.title), ["Work Mail"]);
  assert.deepEqual(searchItems(items, "work octo"), []);
  assert.equal(searchItems(items, "").length, 3);
  const many = Array.from({ length: 500 }, (_, i) => item(`Site ${i}`, [`site${i}.example`]));
  assert.equal(searchItems(many, "site", 100).length, 100);
});

test("same site means the same registrable domain", () => {
  assert.equal(sameSite("https://login.example.com", "https://example.com"), true);
  assert.equal(sameSite("https://a.github.io", "https://b.github.io"), false);
  assert.equal(sameSite("https://example.com", "https://example.org"), false);
});
