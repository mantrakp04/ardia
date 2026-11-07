import assert from "node:assert/strict";
import { test } from "node:test";
const { parseHooksDocument, hookRevision, parseDuration } = await import("./hookFile.ts");
const { approvalFor, launchActionApproval, applyTemplate, safeRewriteTarget } = await import("./hookPolicy.ts");
const { parseMatchPattern, matchesUrl } = await import("../../lib/matchPattern.ts");

const parse = (...hooks) => parseHooksDocument({ hooks });
const problem = (hook) => parse({ name: "h", ...hook }).problems[0] ?? null;

test("match patterns match like userscripts: scheme, host, subdomains, path globs, literal ?", () => {
  const spec = (p) => parseMatchPattern(p);
  assert.equal(matchesUrl(spec("https://*.example.com/*"), "https://a.example.com/x?y=1"), true);
  assert.equal(matchesUrl(spec("https://*.example.com/*"), "https://example.com/"), true);
  assert.equal(matchesUrl(spec("https://*.example.com/*"), "https://badexample.com/"), false);
  assert.equal(matchesUrl(spec("*://example.com/a*"), "http://example.com/abc"), true);
  assert.equal(matchesUrl(spec("*://example.com/a*"), "ftp://example.com/abc"), false);
  assert.equal(matchesUrl(spec("https://example.com/a?b"), "https://example.com/aXb"), false);
  assert.equal(matchesUrl(spec("https://example.com:8443/*"), "https://example.com/"), false);
  assert.equal(matchesUrl(spec("<all_urls>"), "file:///tmp/x"), true);
  assert.ok("error" in spec("https://ex*ample.com/*"));
  assert.ok("error" in spec("https://example.com"));
});

test("every hook takes exactly one trigger and one action, and unknown keys are invalid", () => {
  assert.equal(parse({ name: "a", on: "tab.opened", run: ["/bin/true"] }).problems.length, 0);
  assert.match(problem({ on: ["tab.opened"], run: ["/bin/true"], bogus: 1 }), /unknown key bogus/);
  assert.match(problem({ on: ["tab.opened"], run: ["/bin/true"], command: "newTab" }), /exactly one of run, command/);
  assert.match(problem({ on: ["tab.opened"] }), /exactly one of run, command/);
  assert.match(problem({ on: ["tab.opened"], every: "1h", run: ["x"] }), /exactly one of on, at, every/);
  assert.match(problem({ on: ["tab.opened"], run: "x" }), /run must be a list/);
  assert.match(problem({ on: ["nope.event"], run: ["x"] }), /unknown event nope.event/);
  assert.match(problem({ on: ["tab.opened"], command: "newTab", timeout: 3 }), /timeout only goes with run/);
  assert.match(problem({ on: ["tab.opened"], run: ["x"], arg: "y" }), /arg only goes with command/);
  assert.deepEqual(parse({ name: "c", on: "tab.opened", command: "reload", arg: "x" }).hooks[0].command, { id: "reload", arg: "x" });
  assert.match(parse({ name: "d", on: "tab.opened", run: ["x"] }, { name: "d", on: "tab.opened", run: ["y"] }).problems[0], /used twice/);
});

test("decide hooks: one event, the answer keys of that event only, no command, no timeout", () => {
  assert.match(problem({ on: ["tab.opening", "tab.opened"], cancel: true }), /goes alone/);
  assert.match(problem({ on: ["tab.opening"], command: "newTab" }), /can't answer a decide event/);
  assert.match(problem({ on: ["tab.opening"], folder: "~/Downloads/x" }), /folder only goes with on: \["download.deciding"\]/);
  assert.match(problem({ on: ["link.opening"], run: ["x"], timeout: 5 }), /fixed deadlines/);
  assert.match(problem({ on: ["download.deciding"], folder: "/etc" }), /under your home folder/);
  assert.match(problem({ on: ["download.deciding"], folder: "~/Downloads/../.ssh" }), /\.\./);
  assert.match(problem({ on: ["permission.requested"], permission: "always" }), /allow, deny or ask/);
  assert.match(problem({ on: ["tab.opening"], rewrite: [{ match: "https://a.com/*", to: "javascript:alert(1)" }] }), /http or https/);
  assert.match(problem({ on: ["link.opening"], route: { profile: "Work", window: "w1" } }), /route is/);
  const hook = parse({ name: "r", on: "tab.opening", rewrite: [{ match: "https://www.reddit.com/*", to: "https://old.reddit.com{path}{query}" }] }).hooks[0];
  assert.equal(hook.decide, "tab.opening");
  assert.equal(hook.rules.rewrite[0].to, "https://old.reddit.com{path}{query}");
});

test("idle, schedules and omnibox keys are checked", () => {
  assert.match(problem({ on: ["tab.idle"], run: ["x"] }), /needs idle/);
  assert.match(problem({ on: ["tab.idle"], run: ["x"], idle: "30s" }), /at least 1m/);
  assert.equal(problem({ on: ["tab.idle", "tab.resumed"], run: ["x"], idle: "30m" }), null);
  assert.match(problem({ on: ["tab.opened"], run: ["x"], idle: "30m" }), /idle only goes with/);
  assert.equal(problem({ at: "09:00", days: ["mon", "fri"], command: "newTab" }), null);
  assert.match(problem({ at: "9am", command: "newTab" }), /at must be a time/);
  assert.match(problem({ every: "30s", command: "newTab" }), /at least 1m/);
  assert.match(problem({ every: "1h", days: ["mon"], command: "newTab" }), /days only goes with at/);
  assert.equal(problem({ omnibox: { title: "Jira", keyword: "j" }, run: ["x"] }), null);
  assert.match(problem({ omnibox: { title: "Jira", keyword: "j", global: true }, run: ["x"] }), /not both/);
  assert.match(problem({ omnibox: { title: "Jira", keyword: "j" }, command: "newTab" }), /command can't answer/);
  assert.equal(parseDuration("2h"), 7200);
});

test("privileged rules need approval, keyed by the exact rule; deny and query stripping don't", () => {
  const hooks = parse(
    { name: "strip", on: "tab.opening", rewrite: [{ match: "https://*/*", to: "{origin}{path}" }] },
    { name: "cross", on: "tab.opening", rewrite: [{ match: "https://www.reddit.com/*", to: "https://old.reddit.com{path}" }] },
    { name: "deny", on: "permission.requested", permission: "deny" },
    { name: "cancel", on: "tab.opening", cancel: true, match: "https://tiktok.com/*" },
    { name: "route", on: "link.opening", route: { profile: "Work" } },
    { name: "dl", on: "download.deciding", folder: "~/Downloads/Invoices" },
    { name: "dl2", on: "download.deciding", folder: "~/Documents/Finance" },
    { name: "prog", on: "tab.opening", run: ["~/bin/x"] },
    { name: "jira", omnibox: { title: "Jira", keyword: "j" }, run: ["~/bin/jira"] },
  ).hooks;
  const kinds = Object.fromEntries(hooks.map((h) => [h.name, approvalFor(h)?.kind ?? null]));
  assert.deepEqual(kinds, { strip: null, cross: "rewrite", deny: null, cancel: null, route: "route", dl: null, dl2: "folder", prog: "program", jira: "omnibox" });
  const edited = parse({ name: "cross", on: "tab.opening", rewrite: [{ match: "https://www.reddit.com/*", to: "https://evil.example{path}" }] }).hooks[0];
  assert.notEqual(approvalFor(edited).key, approvalFor(hooks[1]).key);
  assert.equal(hookRevision({ b: 1, a: [1, { d: 2, c: 3 }] }), hookRevision({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(launchActionApproval("newTab"), null);
  assert.equal(launchActionApproval("closeAllTabs").kind, "launchAction");
});

test("rewrite results are only canonical http(s) URLs without credentials", () => {
  assert.equal(applyTemplate("{origin}{path}", "https://a.com/x?utm=1#h"), "https://a.com/x");
  assert.equal(safeRewriteTarget("https://user:pw@a.com/"), null);
  assert.equal(safeRewriteTarget("file:///etc/passwd"), null);
  assert.equal(safeRewriteTarget("javascript:alert(1)"), null);
  assert.equal(safeRewriteTarget("https://A.com/x"), "https://a.com/x");
});
