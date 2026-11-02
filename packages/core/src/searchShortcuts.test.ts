import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_ENGINES, makeCustomEngine, validateEngine } from "./engines.ts";
import { findScope, offeredSiteSearch, scopedSearchUrl, emptyScopedUrl } from "./siteSearch.ts";
import { siteSearches, validSiteSearchOverride, validSearchTemplate } from "./siteSearches.ts";

const sources = { engines: BUILT_IN_ENGINES, hosts: ["docs.google.com"] };

test("Docs uses signed-in document search even with a competing inline completion and history", () => {
  for (const typed of ["docs", "DOCS", "docs.google.com"]) {
    const scope = offeredSiteSearch(typed, typed.toLowerCase() === "docs" ? ".google.com" : "", sources)!;
    assert.equal(scope.kind, "site");
    const url = new URL(scopedSearchUrl(scope, "private budget & 中文 #/+%", BUILT_IN_ENGINES[0]!));
    assert.equal(url.origin + url.pathname, "https://docs.google.com/document/u/0/");
    assert.equal(url.searchParams.get("q"), "private budget & 中文 #/+%");
  }
});

test("Google products and chat services have distinct destinations", () => {
  const cases = [
    ["sheets", "https://docs.google.com/spreadsheets/u/0/?q=hello"],
    ["slides", "https://docs.google.com/presentation/u/0/?q=hello"],
    ["drive", "https://drive.google.com/drive/search?q=hello"],
    ["gmail", "https://mail.google.com/mail/u/0/#search/hello"],
    ["maps", "https://www.google.com/maps/search/hello"],
    ["gh", "https://github.com/search?q=hello"],
    ["youtube", "https://www.youtube.com/results?search_query=hello"],
    ["chatgpt", "https://chatgpt.com/?q=hello"],
    ["claude", "https://claude.ai/new?q=hello"],
  ];
  for (const [key, url] of cases) {
    const scope = findScope(key!, sources)!;
    assert.ok(scope, key);
    assert.equal(scopedSearchUrl(scope, "hello", BUILT_IN_ENGINES[0]!), url);
    if (["chatgpt", "claude"].includes(key!)) assert.equal(scope.action, "ask");
  }
});

test("custom shortcuts override preset keywords and keep their IDs, aliases and enabled state", () => {
  const custom = { ...makeCustomEngine({ name: "School Docs", keyword: "docs", aliases: ["school"], url: "https://docs.google.com/document/u/1/?q=%s" }, "school-docs"), custom: true };
  for (const key of ["docs", "school"]) {
    const scope = offeredSiteSearch(key, ".example.com", { ...sources, engines: [...BUILT_IN_ENGINES, custom] })!;
    assert.equal(scope.engineId, "school-docs");
    assert.match(scopedSearchUrl(scope, "notes", BUILT_IN_ENGINES[0]!), /\/u\/1\//);
  }
  assert.equal(validateEngine({ name: "Other", keyword: "other", aliases: ["school"], url: "https://example.com/?q=%s" }, [custom]), "That shortcut or alias is already used by another search engine.");
  assert.equal(findScope("school", { engines: [{ ...custom, enabled: false }] }), null);
});

test("preset edits and disabling apply without falling back to public search", () => {
  const original = siteSearches().find((s) => s.host === "docs.google.com")!;
  const override = { name: original.name, keyword: "documents", aliases: ["schooldocs"], url: "https://docs.google.com/document/u/1/?q=%s", enabled: true };
  const edited = { ...sources, sites: siteSearches({ [original.host]: override }) };
  assert.equal(findScope("docs", edited), null);
  assert.equal(findScope("schooldocs", edited)?.url, override.url);
  const disabled = { ...sources, sites: siteSearches({ [original.host]: { ...override, enabled: false } }) };
  for (const key of ["documents", "docs.google.com"]) assert.equal(offeredSiteSearch(key, "", disabled), null);
});

test("search templates reject executable schemes, credentials, broken URLs and host substitutions", () => {
  for (const url of ["javascript:alert('%s')", "file:///%s", "https://%s.example.com/", "https://user:password@example.com/?q=%s", "https://example.com/", "https://example.com/a b?q=%s"]) assert.equal(validSearchTemplate(url), false, url);
  assert.equal(validSearchTemplate("https://example.com/search/%s"), true);
  assert.equal(validSiteSearchOverride({ name: "Docs", keyword: "docs", aliases: [], url: "https://docs.google.com/document/?q=%s", enabled: true }), true);
  assert.equal(validSiteSearchOverride({ name: "Docs", keyword: "docs", aliases: [null], url: "https://docs.google.com/document/?q=%s", enabled: true }), false);
});

test("disabled shortcuts stop competing completions and engine-domain collisions", () => {
  const overrides = Object.fromEntries(["docs.google.com", "chatgpt.com"].map((host) => {
    const site = siteSearches().find((s) => s.host === host)!;
    return [host, { name: site.name, keyword: site.keyword!, aliases: [], url: site.url, enabled: false }];
  }));
  const engines = [...BUILT_IN_ENGINES, { id: "extension-docs", keyword: "docs.google.com", name: "Extension", url: "https://example.com/?q=%s" }];
  const disabled = { engines, sites: siteSearches(overrides), hosts: ["docs.example.com", "docs.google.com"] };
  assert.equal(offeredSiteSearch("docs", ".example.com", disabled), null);
  assert.equal(findScope("docs.google.com", disabled), null);
  assert.equal(findScope("chatgpt.com", disabled), null);
  const chat = overrides["chatgpt.com"]!;
  const edited = { ...disabled, sites: siteSearches({ ...overrides, "chatgpt.com": { ...chat, enabled: true, url: "https://chatgpt.com/?temporary-chat=true&q=%s" } }) };
  assert.equal(findScope("chatgpt.com", edited)?.url, "https://chatgpt.com/?temporary-chat=true&q=%s");
});


test("Enter with no search terms opens the original site URL or the shortcut's site", () => {
  const github = findScope("github.com/mantrakp04/ardia", sources)!;
  assert.equal(emptyScopedUrl(github, "github.com/mantrakp04/ardia"), "https://github.com/mantrakp04/ardia");
  assert.equal(emptyScopedUrl(github, "gh"), "https://github.com/");
  const google = findScope("google", sources)!;
  assert.equal(emptyScopedUrl(google, "google"), "https://www.google.com/");
  const docs = findScope("docs", sources)!;
  assert.equal(emptyScopedUrl(docs, "docs.unrelated.example"), "https://docs.google.com/");
  assert.equal(emptyScopedUrl(docs, "javascript:alert(1)"), "https://docs.google.com/");
  const local = findScope("local", { engines: [{ id: "local", custom: true, name: "Local", keyword: "local", url: "http://localhost:8080/search?q=%s" }] })!;
  assert.equal(emptyScopedUrl(local, "local"), "http://localhost:8080/");
});

test("invalid saved templates cannot enter a shortcut or crash empty submission", () => {
  for (const url of ["https://example.com:abc/?q=%s", "https://%s.example.com/"]) {
    const engine = { id: "legacy", name: "Legacy", keyword: "legacy", url, custom: true };
    assert.equal(offeredSiteSearch("legacy", ".example.com", { engines: [engine], hosts: ["legacy.example.com"] }), null);
    assert.equal(emptyScopedUrl({ kind: "engine", name: engine.name, host: "example.com", url }, "legacy"), "");
  }
});

test("saved aliases normalize in the same way as typed shortcuts", () => {
  const docs = siteSearches().find((s) => s.host === "docs.google.com")!;
  const edited = { ...sources, sites: siteSearches({ [docs.host]: { name: docs.name, keyword: "docs", aliases: ["www.github.com"], url: docs.url, enabled: true } }) };
  assert.equal(findScope("www.github.com", edited)?.name, "Google Docs");
  const custom = { ...makeCustomEngine({ name: "Work", keyword: "www.workdocs", aliases: ["https://schooldocs/"], url: docs.url }, "work"), custom: true };
  assert.equal(findScope("www.workdocs", { engines: [custom] })?.name, "Work");
  assert.equal(findScope("https://schooldocs/", { engines: [custom] })?.name, "Work");
});

test("presets keep their identity and behavior when stored overrides contain extra fields", () => {
  const site = siteSearches().find((s) => s.host === "docs.google.com")!;
  const override = { name: "My Docs", keyword: "docs", aliases: [], url: site.url, enabled: true, host: "foreign.example", action: "ask" };
  const changed = siteSearches({ [site.host]: override });
  const scope = findScope("docs", { engines: [], sites: changed })!;
  assert.equal(scope.host, "docs.google.com");
  assert.equal(scope.action, undefined);
  assert.equal(emptyScopedUrl(scope, "docs"), "https://docs.google.com/");
});

test("override keywords and aliases must remain usable after normalization", () => {
  const value = { name: "Docs", keyword: "docs", aliases: [], url: "https://docs.google.com/document/?q=%s", enabled: true };
  for (const key of ["www.", "https://", "/", "github.com/owner/repo", "github?query", "github#fragment"]) {
    assert.equal(validSiteSearchOverride({ ...value, keyword: key }), false, key);
    assert.equal(validSiteSearchOverride({ ...value, aliases: [key] }), false, key);
  }
});

test("App Store searches the Mac App Store rather than Apple's general website", () => {
  const scope = findScope("appstore", sources)!;
  const url = new URL(scopedSearchUrl(scope, "calculator & notes", BUILT_IN_ENGINES[0]!));
  assert.equal(url.origin + url.pathname, "https://apps.apple.com/us/mac/search");
  assert.equal(url.searchParams.get("term"), "calculator & notes");
});
