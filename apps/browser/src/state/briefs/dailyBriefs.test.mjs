import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { registerHooks } from "node:module";
import test from "node:test";

globalThis.__DEV__ = false;
const stub = new URL("../../test-native/index.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/state/briefs/dailyBriefs.ts")) return next(specifier, context);
    const source = specifier === "../../platform/briefs" ? `export * from ${JSON.stringify(stub)}; export const generateDailyBrief = (...args) => globalThis.briefGenerate(...args); export const cancelDailyBriefGeneration = async () => {};`
      : specifier.endsWith("/briefContext") ? "export const collectBriefContext = () => globalThis.briefCollect(); export const generateClaudeBrief = (...args) => globalThis.briefGenerate(...args);" : null;
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
  },
});
const { useBrowser } = await import("../browser/store.ts");
const { docs } = await import("../../test-native/index.ts");
const { deliverDailyBriefs, generateBrief, loadDailyBrief, openDailyBrief, useDailyBriefs } = await import("./dailyBriefs.ts");
const { localBriefDate } = await import("../../lib/briefDates.ts");
const content = { summary: "Today", focus: { title: "Review", body: "Read your PR" }, todos: [], updates: [], events: [] };
const setup = () => {
  docs.clear();
  useBrowser.getState().hydrate({});
  useDailyBriefs.setState({ entries: {} });
  globalThis.briefCollect = async () => ({ github: [], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify(content);
};

test("dated briefs deduplicate within a profile and background delivery preserves the active tab", () => {
  setup();
  const s = useBrowser.getState;
  const w = s().createWindow({ url: "https://example.com" });
  const active = s().windows[w].activeTabIds.default;
  const today = localBriefDate();
  const id = openDailyBrief(w, today, true);
  assert.ok(id);
  assert.equal(s().windows[w].activeTabIds.default, active);
  assert.equal(openDailyBrief(w, today, true), id);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const previous = openDailyBrief(w, localBriefDate(yesterday), true);
  assert.notEqual(previous, id);
  const privateWindow = s().createWindow({ incognito: true });
  assert.equal(openDailyBrief(privateWindow, today), null);
});

test("revoking source consent while collecting prevents provider submission", async () => {
  setup();
  const s = useBrowser.getState;
  s().updateSettings({ dailyBriefSources: { gmail: false, github: true, calendar: false } });
  let release;
  globalThis.briefCollect = () => new Promise((resolve) => { release = resolve; });
  let sent = false;
  globalThis.briefGenerate = async () => { sent = true; return JSON.stringify(content); };
  const run = generateBrief("default", localBriefDate());
  await new Promise((resolve) => setImmediate(resolve));
  s().updateSettings({ dailyBriefSources: { gmail: false, github: false, calendar: false } });
  release({ github: [{ title: "Private PR" }] });
  await run;
  assert.equal(sent, false);
  assert.match(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].error, /preferences changed/);
});

test("concurrent generation is coalesced and a revoked response is not persisted", async () => {
  setup();
  let release;
  let sent = 0;
  globalThis.briefGenerate = () => { sent++; return new Promise((resolve) => { release = resolve; }); };
  const first = generateBrief("default", localBriefDate());
  await new Promise((resolve) => setImmediate(resolve));
  await generateBrief("default", localBriefDate());
  assert.equal(sent, 1);
  useBrowser.getState().updateSettings({ dailyBriefProvider: "claude" });
  release(JSON.stringify(content));
  await first;
  assert.equal(docs.has("daily-briefs.json"), false);
  assert.equal(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content, undefined);
});

test("private generation never reads sources or calls the provider", async () => {
  setup();
  let calls = 0;
  globalThis.briefCollect = async () => { calls++; return {}; };
  await generateBrief("incognito:test@default", localBriefDate());
  assert.equal(calls, 0);
  assert.equal(docs.has("daily-briefs.json"), false);
});

test("focus links bind provider references to real GitHub context titles and URLs", async () => {
  setup();
  const trusted = { title: "Actual PR title", url: "https://github.com/owner/repo/pull/42" };
  globalThis.briefCollect = async () => ({ github: [trusted], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Review", body: "Review code", sourceUrls: [trusted.url, "https://github.com/owner/repo/pull/999"] } });
  await generateBrief("default", localBriefDate());
  const entry = useDailyBriefs.getState().entries[`default/${localBriefDate()}`];
  assert.deepEqual(entry.content.focus.links, [trusted]);
  assert.deepEqual(JSON.parse(docs.get("daily-briefs.json"))[`default/${localBriefDate()}`].focus.links, [trusted]);
});

test("focus PR-number fallback only links a unique matching source", async () => {
  setup();
  const trusted = { title: "Actual PR title", url: "https://github.com/owner/repo/pull/42" };
  globalThis.briefCollect = async () => ({ github: [trusted], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Prepare PR #42", body: "Review code" } });
  await generateBrief("default", localBriefDate());
  assert.deepEqual(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.focus.links, [trusted]);
  globalThis.briefCollect = async () => ({ github: [trusted, { title: "Different PR", url: "https://github.com/other/repo/pull/42" }], calendar: [] });
  await generateBrief("default", localBriefDate());
  assert.deepEqual(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.focus.links, []);
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Review", body: "https://github.com/owner/repo/pull/420" } });
  await generateBrief("default", localBriefDate());
  assert.deepEqual(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.focus.links, []);
});

test("update source metadata comes from real collected PRs and Gmail messages", async () => {
  setup();
  const github = { title: "Actual PR", url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" };
  const gmail = { id: "abc123def456", url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" };
  globalThis.briefCollect = async () => ({ github: [github], gmail: [gmail], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, updates: [
    { title: "Code update", body: "Review", source: { kind: "gmail", url: github.url, project: "Invented project" } },
    { title: "Email update", body: "Read", sourceUrl: gmail.url },
    { title: "Invented reference", body: "Read", sourceUrl: "https://github.com/owner/repo/pull/999" },
    { title: "No source", body: "Nothing matching" },
  ] });
  await generateBrief("default", localBriefDate());
  const updates = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.updates;
  assert.deepEqual(updates[0].source, { kind: "github", url: github.url, project: "repo" });
  assert.deepEqual(updates[1].source, { kind: "gmail", url: gmail.url });
  assert.equal(updates[2].source, undefined);
  assert.equal(updates[3].source, undefined);
});

test("legacy update references match unique PR numbers or exact Gmail message identifiers", async () => {
  setup();
  const github = { title: "Actual PR", url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" };
  const gmail = { id: "abc123def456", url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" };
  globalThis.briefCollect = async () => ({ github: [github], gmail: [gmail], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, updates: [
    { title: "PR #42 updated", body: "Review" },
    { title: "Email update", body: "Message abc123def456 needs attention" },
    { title: "Email update", body: "Message abc123def4567 is different" },
    { title: "Mixed update PR #42", body: "Message abc123def456" },
  ] });
  await generateBrief("default", localBriefDate());
  const updates = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.updates;
  assert.equal(updates[0].source.url, github.url);
  assert.equal(updates[1].source.url, gmail.url);
  assert.equal(updates[2].source, undefined);
  assert.equal(updates[3].source, undefined);
});


test("real provider url fields bind focus, todos and Gmail focus links", async () => {
  setup();
  const github = { title: "Fix sidebar clipping during live resize", url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" };
  const gmail = { id: "abc123def456", subject: "Calendar permission review followup", url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" };
  globalThis.briefCollect = async () => ({ github: [github], gmail: [gmail], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, summary: "Sunday, October 25: Review your calendar permissions.", focus: { title: "Mail", body: "Read", url: gmail.url }, todos: [{ title: "Prepare review", body: "Read", url: github.url }] });
  await generateBrief("default", localBriefDate());
  const generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.deepEqual(generated.focus.source, { kind: "gmail", url: gmail.url });
  assert.deepEqual(generated.focus.links, [{ title: gmail.subject, url: gmail.url, kind: "gmail" }]);
  assert.deepEqual(generated.todos[0].source, { kind: "github", url: github.url, project: "repo" });
  assert.equal(generated.summary, "Review your calendar permissions.");
});

test("distinctive source titles recover omitted URLs without guessing unrelated or ambiguous sources", async () => {
  setup();
  const github = { title: "Fix sidebar clipping during live resize", url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" };
  const gmail = { id: "abc123def456", subject: "Calendar permission review followup", url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" };
  globalThis.briefCollect = async () => ({ github: [github], gmail: [gmail], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Check calendar permission followup", body: "Prepare the calendar permission review followup." }, todos: [{ title: "Fix sidebar clipping during live resize", body: "Check the implementation." }], updates: [{ title: "Review", body: "An unrelated change needs attention." }] });
  await generateBrief("default", localBriefDate());
  let generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.equal(generated.focus.source.url, gmail.url);
  assert.equal(generated.focus.links[0].url, gmail.url);
  assert.equal(generated.todos[0].source.url, github.url);
  assert.equal(generated.updates[0].source, undefined);
  globalThis.briefCollect = async () => ({ github: [github, { ...github, url: "https://github.com/other/repo/pull/43" }], gmail: [], calendar: [] });
  await generateBrief("default", localBriefDate());
  generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.equal(generated.todos[0].source, undefined);
});


test("legacy provider URLs bind all sections and survive loading the generated saved brief", async () => {
  setup();
  const context = {
    github: [{ title: "Fix sidebar clipping during live resize", url: "https://github.com/ardia/browser/pull/42", repository: "ardia/browser" }],
    gmail: [{ id: "abc123def456", subject: "Calendar permission review followup", url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" }],
    calendar: [],
  };
  const raw = {
    summary: "Sunday, October 25: Review your calendar permissions and prepare the sidebar fix. " + "Several additional updates need attention. ".repeat(5),
    focus: { title: "Calendar permission review followup", body: "Read the latest email before replying.", url: context.gmail[0].url },
    todos: [{ title: "Prepare sidebar fix", body: "Review the PR.", url: context.github[0].url }],
    updates: [{ title: "Sidebar resize fix", body: "The change is ready for review.", url: context.github[0].url }, { title: "Calendar permission review followup", body: "A reply arrived.", url: context.gmail[0].url }],
    events: [],
  };
  globalThis.briefCollect = async () => context;
  globalThis.briefGenerate = async () => JSON.stringify(raw);
  await generateBrief("default", localBriefDate());
  const generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.equal(generated.focus.source.kind, "gmail");
  assert.equal(generated.focus.links[0].kind, "gmail");
  assert.equal(generated.todos[0].source.kind, "github");
  assert.deepEqual(generated.updates.map((item) => item.source.kind), ["github", "gmail"]);
  assert.ok(generated.summary.length <= 160);
  assert.doesNotMatch(generated.summary, /October 25/);
  useDailyBriefs.setState({ entries: {} });
  loadDailyBrief("default", localBriefDate());
  assert.deepEqual(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content, generated);
  if (process.env.ARDIA_SOURCE_AUDIT) {
    mkdirSync(dirname(process.env.ARDIA_SOURCE_AUDIT), { recursive: true });
    writeFileSync(process.env.ARDIA_SOURCE_AUDIT, JSON.stringify({ raw, context, generated }, null, 2));
  }
});


test("matching GitHub and Gmail titles stay ambiguous across all source types", async () => {
  setup();
  const title = "Fix sidebar clipping during live resize";
  const github = { title, url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" };
  const gmail = { id: "abc123def456", subject: title, url: "https://mail.google.com/mail/u/?authuser=second%40example.com#all/abc123def456" };
  globalThis.briefCollect = async () => ({ github: [github], gmail: [gmail], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title, body: "Ready to review." }, todos: [{ title, body: "Ready to review." }], updates: [{ title, body: "Ready to review." }] });
  await generateBrief("default", localBriefDate());
  let generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.equal(generated.focus.source, undefined);
  assert.deepEqual(generated.focus.links, []);
  assert.equal(generated.todos[0].source, undefined);
  assert.equal(generated.updates[0].source, undefined);
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title, body: "Ready to review.", url: github.url }, updates: [{ title, body: "Ready to review.", url: gmail.url }] });
  await generateBrief("default", localBriefDate());
  generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.equal(generated.focus.source.url, github.url);
  assert.deepEqual(generated.focus.links.map((link) => link.url), [github.url]);
  assert.equal(generated.updates[0].source.url, gmail.url);
});


test("generated focus ignores extra model citations when only one PR is mentioned", async () => {
  setup();
  const github = [{ title: "First PR", url: "https://github.com/owner/repo/pull/192", repository: "owner/repo" }, { title: "Other PR", url: "https://github.com/owner/repo/pull/193", repository: "owner/repo" }];
  const gmail = [{ id: "abc123def456", subject: "Related email", url: "https://mail.google.com/mail/u/?authuser=person%40example.com#all/abc123def456" }];
  globalThis.briefCollect = async () => ({ github, gmail, calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Prepare PR #192", body: "Read the review.", sourceUrls: [...github.map((item) => item.url), gmail[0].url] } });
  await generateBrief("default", localBriefDate());
  let generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.deepEqual(generated.focus.links.map((link) => link.url), [github[0].url]);
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Prepare PR #192", body: "Read #193 too.", sourceUrls: [...github.map((item) => item.url), gmail[0].url] } });
  await generateBrief("default", localBriefDate());
  generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.deepEqual(generated.focus.links.map((link) => link.url), github.map((item) => item.url));
});


test("automatic brief generation retries a transient failure without reopening a dismissed brief", async () => {
  setup();
  const window = useBrowser.getState().createWindow({ url: "https://example.com" });
  useBrowser.getState().updateSettings({ dailyBriefEnabled: true, dailyBriefDelivery: "onOpen", dailyBriefLastOpened: "" });
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let attempts = 0;
  globalThis.briefGenerate = async () => { attempts++; if (attempts === 1) throw new Error("Temporary failure"); return JSON.stringify(content); };
  await deliverDailyBriefs(now);
  assert.equal(attempts, 1);
  assert.equal(useBrowser.getState().settings.dailyBriefLastOpened, localBriefDate(now));
  const briefTab = useBrowser.getState().windows[window].tabIds.find((id) => useBrowser.getState().tabs[id].url.startsWith("ardia://brief/"));
  assert.ok(briefTab);
  useBrowser.getState().closeTab(briefTab);
  await deliverDailyBriefs(now);
  assert.equal(attempts, 1);
  await deliverDailyBriefs(new Date(now.getTime() + 5 * 60_000));
  assert.equal(attempts, 2);
  assert.ok(useDailyBriefs.getState().entries[`default/${localBriefDate(now)}`].content);
  assert.equal(useBrowser.getState().windows[window].tabIds.some((id) => useBrowser.getState().tabs[id].url.startsWith("ardia://brief/")), false);
  await deliverDailyBriefs(new Date(now.getTime() + 10 * 60_000));
  assert.equal(attempts, 2);
});

test("automatic failures have a persisted three-attempt daily limit", async () => {
  setup();
  useBrowser.getState().createWindow({ url: "https://example.com" });
  useBrowser.getState().updateSettings({ dailyBriefEnabled: true, dailyBriefDelivery: "onOpen", dailyBriefLastOpened: "" });
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  let attempts = 0;
  globalThis.briefGenerate = async () => { attempts++; throw new Error("Temporary failure"); };
  for (let i = 0; i < 4; i++) await deliverDailyBriefs(new Date(now.getTime() + i * 5 * 60_000));
  assert.equal(attempts, 3);
  assert.equal(JSON.parse(docs.get("daily-brief-attempts.json")).profiles.default.count, 3);
  useDailyBriefs.setState({ entries: {} });
  await deliverDailyBriefs(new Date(now.getTime() + 20 * 60_000));
  assert.equal(attempts, 3);
});

test("source title matching does not accept a partial trailing word", async () => {
  setup();
  globalThis.briefCollect = async () => ({ github: [{ title: "Authentication refresh", url: "https://github.com/owner/repo/pull/42", repository: "owner/repo" }], gmail: [], calendar: [] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, focus: { title: "Authentication refreshed", body: "Read the notification." }, updates: [{ title: "Authentication refreshed", body: "Read the notification." }] });
  await generateBrief("default", localBriefDate());
  const generated = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content;
  assert.deepEqual(generated.focus.links, []);
  assert.equal(generated.updates[0].source, undefined);
});

test("meeting schedule uses calendar timestamps instead of model generated UTC strings", async () => {
  setup();
  const start = "2026-10-25T17:00:00.000Z", end = "2026-10-25T17:15:00.000Z";
  globalThis.briefCollect = async () => ({ github: [], gmail: [], calendar: [{ title: "Bachs Intro", start, end, allDay: false }] });
  globalThis.briefGenerate = async () => JSON.stringify({ ...content, events: [{ title: "Bachs Intro", time: "2026-10-25T17:00:00.000Z", body: "Timestamps are UTC; no timezone provided." }, { title: "Invented meeting", time: "09:00", body: "Not in the calendar." }] });
  await generateBrief("default", localBriefDate());
  const event = useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.events;
  assert.equal(event.length, 1);
  assert.equal(event[0].title, "Bachs Intro");
  assert.equal(event[0].start, start);
  assert.equal(event[0].end, end);
  assert.doesNotMatch(event[0].time, /2026|UTC|T17/);
  assert.equal(event[0].body, "15-minute calendar event.");
  useDailyBriefs.setState({ entries: {} });
  loadDailyBrief("default", localBriefDate());
  assert.deepEqual(useDailyBriefs.getState().entries[`default/${localBriefDate()}`].content.events, event);
});
