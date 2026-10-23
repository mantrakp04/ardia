import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("./browser.ts");
const { linkRuleMatches, linkRuleProfile, linkRuleTarget, savedLinkRules } = await import("./linkRules.ts");

const S = () => useBrowser.getState();
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
  side: { id: "side", name: "Side", color: "green", icon: null, createdAt: 0 },
};
const withRules = (linkRules) =>
  S().hydrate({ profiles: PROFILES, profileOrder: ["default", "work", "side"], windows: {}, tabs: {}, settings: { linkRules } });
const matches = (pattern, url) => linkRuleMatches(linkRuleTarget(pattern), url);

test("a rule is a site with an optional path, typed loosely", () => {
  assert.deepEqual(linkRuleTarget("github.com"), { host: "github.com", path: "" });
  assert.deepEqual(linkRuleTarget("  https://WWW.GitHub.com/Acme/?tab=repos "), { host: "github.com", path: "/acme" });
  assert.deepEqual(linkRuleTarget("*.slack.com"), { host: "slack.com", path: "" });
  assert.deepEqual(linkRuleTarget("localhost:3000/app/"), { host: "localhost", path: "/app" });
  assert.equal(linkRuleTarget(""), null);
  assert.equal(linkRuleTarget("   "), null);
  assert.equal(linkRuleTarget("not a site"), null);
  assert.equal(linkRuleTarget("/just/a/path"), null);
});

test("a site matches itself and its subdomains, never a look-alike", () => {
  assert.ok(matches("github.com", "https://github.com/"));
  assert.ok(matches("github.com", "https://gist.github.com/x"));
  assert.ok(matches("github.com", "http://GITHUB.COM./x"));
  assert.ok(matches("github.com", "https://user@github.com:443/x"));
  assert.ok(!matches("github.com", "https://notgithub.com/"));
  assert.ok(!matches("github.com", "https://github.com.evil.example/"));
  assert.ok(!matches("github.com", "file:///github.com/x"));
  assert.ok(!matches("github.com", "mailto:me@github.com"));
});

test("a path matches whole segments only", () => {
  assert.ok(matches("github.com/acme", "https://github.com/acme"));
  assert.ok(matches("github.com/acme", "https://github.com/Acme/repo?x=1#top"));
  assert.ok(!matches("github.com/acme", "https://github.com/acmecorp/repo"));
  assert.ok(!matches("github.com/acme", "https://github.com/other?acme"));
});

test("the first matching rule picks the profile; no match leaves it to the last active profile", () => {
  withRules([
    { id: "r1", pattern: "github.com/acme", profileId: "work" },
    { id: "r2", pattern: "github.com", profileId: "side" },
  ]);
  assert.equal(linkRuleProfile(S(), "https://github.com/acme/app/pull/1"), "work");
  assert.equal(linkRuleProfile(S(), "https://github.com/someone"), "side");
  assert.equal(linkRuleProfile(S(), "https://example.com/"), null);
});

test("a rule for a deleted profile is dropped, and an empty or broken one never matches", () => {
  withRules([
    { id: "r1", pattern: "", profileId: "work" },
    { id: "r2", pattern: "not a site", profileId: "work" },
    { id: "r3", pattern: "linear.app", profileId: "gone" },
    { id: "r4", pattern: "figma.com", profileId: "side" },
  ]);
  assert.equal(linkRuleProfile(S(), "https://linear.app/x"), null);
  assert.deepEqual(savedLinkRules(S()), [{ host: "figma.com", path: "", profile: "side" }]);
  S().deleteProfile("side");
  assert.deepEqual(S().settings.linkRules.map((r) => r.id), ["r1", "r2", "r3"]);
  assert.equal(linkRuleProfile(S(), "https://figma.com/file/1"), null);
});

test("native reads the rules from the session under engine profile names", () => {
  withRules([
    { id: "r1", pattern: "Mail.Google.com", profileId: "default" },
    { id: "r2", pattern: "github.com/acme", profileId: "work" },
  ]);
  assert.deepEqual(savedLinkRules(S()), [
    { host: "mail.google.com", path: "", profile: "" },
    { host: "github.com", path: "/acme", profile: "work" },
  ]);
});
