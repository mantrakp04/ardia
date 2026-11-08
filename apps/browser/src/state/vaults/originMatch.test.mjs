import assert from "node:assert/strict";
import { test } from "node:test";
import { bestItem, fillsWithoutChoice, isRegistrySuffix, isSecureOrigin, isSharedHosting, loginSavedIn, matchTier, parseSite, rankItems, registrableDomain, sameSite, searchItems, siteKey, TIER } from "./originMatch.ts";

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

test("www is the bare domain, one step below the exact host", () => {
  assert.equal(matchTier("https://www.example.com", "https://example.com"), TIER.www);
  assert.equal(matchTier("https://example.com", "www.example.com"), TIER.www);
  assert.equal(matchTier("https://www.example.com", "www.example.com"), TIER.exact);
  const ranked = rankItems([item("bare", ["example.com"]), item("www", ["www.example.com"])], "https://www.example.com");
  assert.deepEqual(ranked.map((r) => r.item.id), ["www", "bare"]);
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
  assert.equal(loginSavedIn([item("y", ["https://login.example.com"], { username: "me" })], "https://app.example.com", "me"), true, "a sibling counts, so a save never duplicates it");
  assert.equal(loginSavedIn([item("z", ["https://example.org"], { username: "me" })], "https://app.example.com", "me"), false);
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

test("suffix rules mirror the native VaultOriginMatch", () => {
  assert.equal(matchTier("https://evil.github.io", "github.io"), TIER.none, "a shared-hosting suffix item matches no tenant");
  assert.equal(matchTier("https://b.github.io", "https://a.github.io"), TIER.none);
  assert.equal(matchTier("https://x.a.github.io", "https://a.github.io"), TIER.none, "shared hosting needs the exact host");
  assert.equal(matchTier("https://a.github.io", "https://a.github.io/login"), TIER.exact);
  assert.equal(matchTier("https://bucket.s3.amazonaws.com", "https://other.s3.amazonaws.com"), TIER.none);
  assert.equal(matchTier("https://login.example.co.uk", "example.co.uk"), TIER.subdomain);
  for (const page of ["https://example.co.uk", "https://login.example.co.uk", "https://shop.co.uk"]) assert.equal(matchTier(page, "co.uk"), TIER.none, `co.uk against ${page}`);
  assert.equal(matchTier("https://shop.com.co", "com.co"), TIER.none, "two-label registry rule on a two-letter TLD");
  assert.equal(matchTier("https://a.gob.mx", "https://b.gob.mx"), TIER.none);
  assert.equal(matchTier("https://login.example.com", "*.example.com"), TIER.none);
  assert.equal(matchTier("https://example.com", "*.example.com"), TIER.none);
  assert.equal(parseSite("https://*.example.com"), null);
  assert.equal(parseSite("https://exa mple.com"), null);
  assert.equal(isRegistrySuffix("co.uk"), true);
  assert.equal(isRegistrySuffix("nom.fr"), true);
  assert.equal(isRegistrySuffix("com.com"), false);
  assert.equal(isRegistrySuffix("github.io"), true);
  assert.equal(isSharedHosting("alice.vercel.app"), true);
  assert.equal(registrableDomain("co.uk"), "");
  assert.equal(registrableDomain("x.a.github.io"), "x.a.github.io");
});

const CASES = [
  ["https://github.com", "https://github.com/login", "exact"],
  ["https://github.com", "github.com", "exact"],
  ["https://github.com", "github.com/login?next=%2F#top", "exact"],
  ["https://github.com", "https://user@github.com", "exact"],
  ["https://www.github.com", "github.com", "www"],
  ["https://github.com", "https://www.github.com/session", "www"],
  ["https://accounts.google.com", "google.com", "subdomain"],
  ["https://google.com", "accounts.google.com", "subdomain"],
  ["https://www.google.com", "https://accounts.google.com", "subdomain"],
  ["https://a.b.example.com", "b.example.com", "subdomain"],
  ["https://mail.google.com", "https://accounts.google.com", "sibling"],
  ["https://a.b.example.com", "c.example.com", "sibling"],
  ["https://login.example.co.uk", "https://shop.example.co.uk", "sibling"],
  ["https://example.co.uk", "https://example.co.uk/account", "exact"],
  ["https://other.co.uk", "https://example.co.uk", "none"],
  ["https://alice.github.io", "https://alice.github.io/app", "exact"],
  ["https://alice.github.io", "https://bob.github.io", "none"],
  ["https://alice.github.io", "github.io", "none"],
  ["https://app.alice.github.io", "https://alice.github.io", "none"],
  ["https://shop.myshopify.com", "https://other.myshopify.com", "none"],
  ["http://localhost:3000", "localhost:3000", "exact"],
  ["http://localhost:3000", "http://localhost:3000/signin", "exact"],
  ["http://localhost:3000", "localhost:4000", "none"],
  ["http://127.0.0.1:8080", "127.0.0.1:8080", "exact"],
  ["https://192.168.1.10", "https://192.168.1.10/admin", "exact"],
  ["https://192.168.1.10", "https://192.168.1.11", "none"],
  ["https://10.0.0.1", "https://1.10.0.0.1", "none"],
  ["https://[2001:db8::1]", "https://[2001:db8::1]/", "exact"],
  ["https://example.com:8443", "example.com:8443/login", "exact"],
  ["https://example.com:8443", "example.com", "none"],
  ["https://example.com", "http://example.com:80", "none"],
  ["https://xn--bcher-kva.de", "bücher.de", "exact"],
  ["https://shop.xn--bcher-kva.de", "https://konto.bücher.de", "sibling"],
  ["https://example.com", "example.com.evil.net", "none"],
  ["https://example.com", "ftp://example.com", "none"],
  ["https://example.com", "   ", "none"],
];

test("origin tiers across real saved addresses", () => {
  for (const [page, saved, tier] of CASES) assert.equal(matchTier(page, saved), TIER[tier], `${saved} on ${page}`);
});

test("rows only fill without the person's choice where the native check would agree", () => {
  const at = (urls, origin) => fillsWithoutChoice(item("x", urls), origin);
  assert.equal(at(["github.com"], "https://github.com"), true);
  assert.equal(at(["github.com"], "https://www.github.com"), true);
  assert.equal(at(["accounts.google.com"], "https://google.com"), true);
  assert.equal(at(["accounts.google.com"], "https://mail.google.com"), false, "siblings need the person's choice");
  assert.equal(at(["login.example.com"], "https://www.example.com"), false, "www only folds for display, natively it's a sibling");
  assert.equal(at(["example.com:8443"], "https://example.com"), false);
  assert.equal(at(["http://localhost:3000"], "http://localhost:3000"), true);
  assert.equal(at(["alice.github.io"], "https://bob.github.io"), false);
  assert.equal(at(["example.com"], "http://example.com"), false);
});

test("the remembered login leads its own tier but never jumps a better match", () => {
  const items = [item("fav", ["example.com"], { favorite: true }), item("mine", ["example.com"]), item("sib", ["login.example.com"])];
  assert.deepEqual(rankItems(items, "https://example.com", "bitwarden/mine").map((r) => r.item.id), ["mine", "fav", "sib"]);
  assert.deepEqual(rankItems(items, "https://example.com", "bitwarden/sib").map((r) => r.item.id), ["fav", "mine", "sib"]);
  assert.deepEqual(rankItems(items, "https://example.com", "bitwarden/gone").map((r) => r.item.id), ["fav", "mine", "sib"]);
});

test("a site key is the registrable domain, or the host where there isn't one", () => {
  assert.equal(siteKey("https://accounts.google.com"), "google.com");
  assert.equal(siteKey("https://www.example.co.uk"), "example.co.uk");
  assert.equal(siteKey("https://alice.github.io"), "alice.github.io");
  assert.equal(siteKey("http://localhost:3000"), "localhost");
  assert.equal(siteKey("https://192.168.1.10"), "192.168.1.10");
  assert.equal(siteKey("not a url"), "");
});
