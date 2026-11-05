import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BUILT_IN_ENGINES } from "./engines.ts";
import { isProviderEntryList, isRemoteEndpoint, providerConfigs, readProviderEntries } from "./providerConfig.ts";
import { isPublicHost, providerApprovalKey, remoteRequestAllowed, sha256Hex } from "./providerNetwork.ts";
import { globalProviderRows, matchProviderRows, parseProviderReply, PROVIDER_LIMITS, providerIcon, providerText, providerUrl, safeProviderRows } from "./providerRows.ts";
import { findScope, offeredSiteSearch, scopedSearchUrl, type SearchScope } from "./siteSearch.ts";
import { buildSuggestions } from "./suggest.ts";

const now = 1_700_000_000_000;
const source = {
  tabs: [],
  history: [
    { url: "https://github.com/", title: "GitHub", favicon: null, visits: 12, lastVisit: now - 2000 },
    { url: "https://github.com/ardia/ardia/issues", title: "Issues · ardia", favicon: null, visits: 8, lastVisit: now - 3000 },
    { url: "https://gist.github.com/", title: "Gists", favicon: null, visits: 3, lastVisit: now - 4000 },
  ],
};
const section = (id: string, n: number, base = "https://team.example.com/") => ({
  id,
  title: "Team",
  rows: Array.from({ length: n }, (_, i) => ({ title: `Team link ${i}`, url: `${base}${i}` })),
});
const keywordProviders = [{ id: "config:go", title: "Linear", keyword: "go", host: "linear.app", url: "https://linear.app/team/issue/%s" }];

test("provider rows keep only http(s) URLs", () => {
  const bad = ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "chrome://settings", "ardia://history", "about:blank", "https://user:pw@evil.com/", "https://good.com@evil.com/", "https:///nohost", "https://a b.com/", "https://x.com/‮evil", " "];
  for (const url of bad) assert.equal(providerUrl(url), null, url);
  for (const url of ["https://linear.app/a?b=1#c", "http://example.com:8080/x", "https://[2001:db8::1]/"]) assert.equal(providerUrl(url), url);
  const rows = safeProviderRows({ id: "p", title: "P" }, [{ title: "evil", url: "javascript:alert(1)" }, { title: "ok", url: "https://ok.com/" }, null, 3, { title: "no url" }]);
  assert.deepEqual(rows.map((r) => r.url), ["https://ok.com/"]);
});

test("provider titles and subtitles are capped and lose control and bidi characters", () => {
  const long = "x".repeat(500);
  const [row] = safeProviderRows({ id: "p", title: "P" }, [{ title: `a‮b\u0000c\n${long}`, subtitle: long, url: "https://a.com/", badge: "ignored" }]);
  assert.ok(row!.title.length <= PROVIDER_LIMITS.title);
  assert.ok(row!.title.startsWith("a b c x"));
  assert.ok(row!.subtitle!.length <= PROVIDER_LIMITS.subtitle);
  assert.equal("badge" in row!, false);
  assert.equal(providerText("⁦hi⁩", 10), "hi");
});

test("provider icons are http(s) or small data:image only", () => {
  assert.equal(providerIcon("https://a.com/i.png"), "https://a.com/i.png");
  assert.equal(providerIcon("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assert.equal(providerIcon(`data:image/png;base64,${"A".repeat(PROVIDER_LIMITS.iconBytes)}`), null);
  assert.equal(providerIcon("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(providerIcon("data:text/html;base64,PGI+"), null);
  assert.equal(providerIcon("javascript:alert(1)"), null);
  assert.equal(providerIcon("file:///x.png"), null);
});

test("global provider rows rank below the top page hits, never first, never the completion", () => {
  const result = buildSuggestions("git", source, { now, providers: [section("team", 2, "https://git.example.com/")] });
  const kinds = result.items.map((s) => s.kind);
  assert.notEqual(kinds[0], "provider");
  assert.equal(result.completion, "hub.com");
  const firstProvider = kinds.indexOf("provider");
  const pagesBefore = result.items.slice(0, firstProvider).filter((s) => s.kind === "page").length;
  assert.equal(pagesBefore, 3);
  assert.equal(kinds.filter((k) => k === "provider").length, 2);
});

test("global provider rows never displace built-in rows", () => {
  const without = buildSuggestions("git", source, { now }).items;
  const withRows = buildSuggestions("git", source, { now, providers: [section("team", 10)] }).items;
  assert.deepEqual(withRows.filter((s) => s.kind !== "provider"), without);
});

test("global sections are capped per provider and in total", () => {
  const rows = globalProviderRows([section("a", 10, "https://a.com/"), section("b", 10, "https://b.com/"), section("c", 10, "https://c.com/")], []);
  assert.equal(rows.filter((r) => r.providerId === "a").length, PROVIDER_LIMITS.rowsPerGlobalSection);
  assert.equal(rows.length, PROVIDER_LIMITS.globalRows);
  assert.equal(rows.some((r) => r.providerId === "c"), false);
});

test("a global provider row for a page already shown is dropped", () => {
  const rows = globalProviderRows([{ id: "a", title: "A", rows: [{ title: "Hub", url: "https://github.com/" }, { title: "Other", url: "https://other.com/" }] }], [
    { kind: "page", url: "https://github.com", title: "GitHub", favicon: null },
  ]);
  assert.deepEqual(rows.map((r) => r.url), ["https://other.com/"]);
});

test("no global provider rows in a site scope, a bang or a ? search", () => {
  const providers = [section("team", 2)];
  const scope: SearchScope = { kind: "site", name: "GitHub", host: "github.com", url: "https://github.com/search?q=%s" };
  assert.equal(buildSuggestions("team", source, { now, providers, scope }).items.some((s) => s.kind === "provider"), false);
  assert.equal(buildSuggestions("?team", source, { now, providers }).items.some((s) => s.kind === "provider"), false);
});

test("keyword mode: the provider's keyword is a scope, and Tab offers it ahead of a completion", () => {
  const scope = findScope("go", { engines: BUILT_IN_ENGINES, providers: keywordProviders });
  assert.equal(scope?.kind, "provider");
  assert.equal(scope?.providerId, "config:go");
  assert.equal(offeredSiteSearch("go", "ogle.com", { engines: BUILT_IN_ENGINES, providers: keywordProviders })?.kind, "provider");
  assert.equal(offeredSiteSearch("goo", "gle.com", { engines: BUILT_IN_ENGINES, providers: keywordProviders })?.kind, "engine");
  assert.equal(scopedSearchUrl(scope!, "ENG-1", BUILT_IN_ENGINES[0]!), "https://linear.app/team/issue/ENG-1");
});

test("keyword mode shows only that provider's rows, the URL template first", () => {
  const scope = findScope("go", { engines: BUILT_IN_ENGINES, providers: keywordProviders })!;
  const providers = [{ id: "config:go", title: "Linear", rows: [{ title: "ENG-12 crash", url: "https://linear.app/team/issue/ENG-12" }] }, section("other", 3)];
  const items = buildSuggestions("ENG-12", source, { now, scope, providers }).items;
  assert.deepEqual(items.map((s) => (s.kind === "provider" ? s.url : s.kind)), ["https://linear.app/team/issue/ENG-12"]);
  const empty = buildSuggestions("", source, { now, scope: { ...scope, url: "" }, providers });
  assert.deepEqual(empty.items.map((s) => s.kind === "provider" && s.title), ["ENG-12 crash"]);
  assert.equal(empty.completion, "");
});

test("static rows match every typed word, title starts first", () => {
  const rows = [
    { title: "Design review", url: "https://a.com/1" },
    { title: "Review queue", url: "https://a.com/2" },
    { title: "Payroll", url: "https://a.com/review" },
  ];
  assert.deepEqual(matchProviderRows(rows, "review").map((r) => r.url), ["https://a.com/2", "https://a.com/1", "https://a.com/review"]);
  assert.deepEqual(matchProviderRows(rows, "design rev").map((r) => r.url), ["https://a.com/1"]);
  assert.equal(matchProviderRows(rows, "").length, 3);
});

test("remote replies: OpenSearch with URLs, OpenSearch through the template, or a plain list", () => {
  assert.deepEqual(parseProviderReply(["q", ["a", "b"], ["first", ""], ["https://x.com/a", ""]], "https://x.com/s?q={query}"), [
    { title: "a", url: "https://x.com/a", subtitle: "first" },
    { title: "b", url: "https://x.com/s?q=b" },
  ]);
  assert.deepEqual(parseProviderReply(["q", ["a"]]), []);
  assert.deepEqual(parseProviderReply([{ title: "t", url: "https://y.com/" }, 4, "x"]), [{ title: "t", url: "https://y.com/" }]);
  assert.deepEqual(parseProviderReply({ title: "t" }), []);
});

test("config entries: each stands alone, problems name the entry", () => {
  const { entries, problems } = readProviderEntries([
    { keyword: "go", url: "https://linear.app/team/issue/{query}" },
    { keyword: "t", title: "Team", rows: [{ title: "Wiki", url: "https://wiki.example.com" }, { title: "Bad", url: "javascript:alert(1)" }] },
    { keyword: "go", url: "https://other.com/{query}" },
    { suggest: "https://s.example.com/?q={query}" },
    { suggest: "http://s.example.com/?q={query}", global: true },
    { keyword: "x", global: true, rows: [] },
    { url: "https://a.com/{query}" },
    { keyword: "bad word", rows: [] },
    { keyword: "n", rows: [{ title: "a", url: "https://a.com" }], extra: 1 },
    { title: "Docs", suggest: "https://docs.example.com/s?q={query}", global: true },
  ]);
  assert.deepEqual(entries.map((e) => e.keyword ?? e.title), ["go", "t", "Docs"]);
  assert.equal(entries[1]!.rows!.length, 1);
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[1].rows[1].url")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[2].keyword")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[3].suggest") && p.includes("global")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[4].suggest")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[5]")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[6].url")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[7].keyword")));
  assert.ok(problems.some((p) => p.startsWith("omniboxProviders[8]") && p.includes("extra")));
  assert.equal(isProviderEntryList(entries), true);
  assert.equal(isProviderEntryList([{ keyword: "a" }]), false);
  const configs = providerConfigs(entries);
  assert.deepEqual(configs.map((c) => [c.id, c.title, c.global]), [["config:go", "linear.app", false], ["config:t", "Team", false], ["config:docs", "Docs", true]]);
});

test("remote endpoints: https or loopback http in the file; requests only to public https hosts", () => {
  assert.equal(isRemoteEndpoint("https://a.com/s?q={query}"), true);
  assert.equal(isRemoteEndpoint("http://127.0.0.1:8123/s?q={query}"), true);
  assert.equal(isRemoteEndpoint("http://a.com/s?q={query}"), false);
  assert.equal(isRemoteEndpoint("https://a.com/s"), false);
  for (const host of ["localhost", "127.0.0.1", "10.0.0.1", "192.168.1.2", "172.20.0.1", "169.254.169.254", "100.64.0.1", "[::1]", "[fd00::1]", "[fe80::1]", "printer.local", "intranet", "2130706433", "0x7f000001", "8.8.8.8", "[2606:4700::1111]", "127.1", "0177.0.0.1", "%31%32%37.0.0.1", "exa_mple.com", "bänk.example"])
    assert.equal(isPublicHost(host), false, host);
  for (const host of ["example.com", "Example.COM", "xn--bnk-sna.example", "a.b-c.io", "example.com."]) assert.equal(isPublicHost(host), true, host);
  for (const url of ["https://127.1/s?q=x", "https://0177.0.0.1/s?q=x", "https://%31%32%37.0.0.1/s?q=x", "https://[0:0:0:0:0:0:0:1]/s?q=x", "https://8.8.8.8/s?q=x", "https://evil.example\\@a.com/s?q=x", "https://u@a.com/s?q=x", "https://a.com:0443/s?q=x", "https://a.com:443/s?q=x"])
    assert.equal(remoteRequestAllowed(url, { allowLoopback: true }), false, url);
  assert.equal(remoteRequestAllowed("https://a.com:8443/s?q=x"), true);
  assert.equal(remoteRequestAllowed("https://Suggest.Example.com/s?q=x"), true);
  assert.equal(remoteRequestAllowed("http://localhost:8123/s?q=x", { allowLoopback: true }), false);
  assert.equal(remoteRequestAllowed("https://a.com/s?q=x"), true);
  assert.equal(remoteRequestAllowed("https://192.168.1.1/s?q=x"), false);
  assert.equal(remoteRequestAllowed("http://127.0.0.1:8123/s?q=x"), false);
  assert.equal(remoteRequestAllowed("http://127.0.0.1:8123/s?q=x", { allowLoopback: true }), true);
  assert.equal(remoteRequestAllowed("http://10.0.0.1/s?q=x", { allowLoopback: true }), false);
});

test("approval keys hash the exact definition", () => {
  for (const text of ["", "abc", "é漢😀", "x".repeat(1000)]) assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"));
  const a = providerApprovalKey({ title: "Docs", suggest: "https://a.com/{query}", global: true });
  assert.equal(a, providerApprovalKey({ global: true, suggest: "https://a.com/{query}", title: "Docs" }));
  assert.notEqual(a, providerApprovalKey({ title: "Docs", suggest: "https://b.com/{query}", global: true }));
});
