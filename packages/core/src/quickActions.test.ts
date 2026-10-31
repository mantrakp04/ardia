import assert from "node:assert/strict";
import { test } from "node:test";
import { makeQuickAction, matchQuickActions, validateQuickAction, type QuickAction } from "./quickActions.ts";
import { buildSuggestions } from "./suggest.ts";

const actions: QuickAction[] = [
  { id: "a", keyword: "open github", url: "https://github.com/mantrakp04/ardia" },
  { id: "b", keyword: "create meeting", url: "https://cal.example.com/new" },
  { id: "c", keyword: "gh", url: "https://github.com/notifications" },
];
const history = [{ url: "https://github.com/", title: "GitHub", favicon: null, visits: 30, lastVisit: Date.UTC(2026, 9, 1) }];
const source = { tabs: [], history };
const now = Date.UTC(2026, 9, 2);

function firstUrl(query: string, quickActions?: QuickAction[]): string | null {
  const first = buildSuggestions(query, source, { now, quickActions }).items[0];
  return first && "url" in first ? first.url : null;
}

test("an exact keyword is the first row and opens its URL", () => {
  const { items, completion } = buildSuggestions("Open  GitHub", source, { now, quickActions: actions });
  assert.deepEqual(items[0], { kind: "create", id: "quick:a", title: "open github", url: "https://github.com/mantrakp04/ardia", site: "github.com", custom: true });
  assert.equal(completion, "");
});

test("an exact keyword beats the inline completion and the built-in create row", () => {
  assert.equal(buildSuggestions("gh", source, { now, quickActions: actions }).items[0]?.kind, "create");
  assert.equal(firstUrl("create meeting", actions), "https://cal.example.com/new");
  assert.equal(firstUrl("create meeting"), "https://meeting.new");
});

test("a keyword prefix lists the action below the search row, and the first row stays", () => {
  const { items } = buildSuggestions("open", source, { now, quickActions: actions });
  assert.equal(items[0]?.kind, "search");
  assert.ok(items.some((s) => s.kind === "create" && s.id === "quick:a"));
});

test("no match leaves the suggestions as they are", () => {
  assert.deepEqual(buildSuggestions("weather", source, { now, quickActions: actions }), buildSuggestions("weather", source, { now }));
  assert.deepEqual(matchQuickActions("g", actions), { exact: false, actions: [] });
});

test("validation needs a keyword, an http URL and a keyword no other action uses", () => {
  assert.equal(validateQuickAction({ keyword: " ", url: "https://x.com" }, actions), "Enter a keyword.");
  assert.equal(validateQuickAction({ keyword: "x", url: "x.com" }, actions), "Enter a URL that starts with http:// or https://.");
  assert.match(validateQuickAction({ keyword: "Open GitHub", url: "https://x.com" }, actions) ?? "", /already used/);
  assert.equal(validateQuickAction({ keyword: "open github", url: "https://x.com" }, actions, "a"), null);
  assert.deepEqual(makeQuickAction({ keyword: "  Open   Docs ", url: " https://docs.new " }, "d"), { id: "d", keyword: "open docs", url: "https://docs.new" });
});
