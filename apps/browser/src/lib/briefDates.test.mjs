import assert from "node:assert/strict";
import test from "node:test";
import { briefDateFromUrl, briefDue, localBriefDate, parseBriefDate } from "./briefDates.ts";
import { briefSummary, focusDisplayLinks, gmailBriefUrl, isSafeBriefSource, parseBriefContent } from "./briefContent.ts";

const settings = { dailyBriefEnabled: true, dailyBriefTime: "08:00", dailyBriefDelivery: "scheduled", dailyBriefLastOpened: "" };

test("brief delivery follows local time, catches up today and never repeats after dismissal", () => {
  const before = new Date(2026, 9, 24, 7, 59);
  const after = new Date(2026, 9, 24, 8, 0);
  assert.equal(briefDue(settings, before), false);
  assert.equal(briefDue(settings, after), true);
  assert.equal(briefDue({ ...settings, dailyBriefLastOpened: localBriefDate(after) }, after), false);
  assert.equal(briefDue({ ...settings, dailyBriefLastOpened: "2026-10-23" }, after), true);
  assert.equal(briefDue({ ...settings, dailyBriefEnabled: false }, after), false);
  assert.equal(briefDue({ ...settings, dailyBriefDelivery: "onOpen" }, before), true);
});

test("invalid times fail closed and calendar dates reject overflow", () => {
  for (const time of ["24:00", "8:00", "08:60", "", "NaN"]) assert.equal(briefDue({ ...settings, dailyBriefTime: time }), false);
  assert.equal(parseBriefDate("2026-02-30"), null);
  assert.equal(parseBriefDate("2026-13-01"), null);
  assert.equal(parseBriefDate("2026-10-24x"), null);
  assert.equal(localBriefDate(new Date(2026, 9, 24, 23, 59)), "2026-10-24");
  assert.equal(briefDateFromUrl("ardia://brief/2026-10-21"), "2026-10-21");
});

test("provider output is validated, bounded and rendered as plain text", () => {
  const content = { summary: "Today", focus: { title: "<script>", body: "Read sources" }, todos: [], updates: [], events: [{ title: "Call", body: "Meet", time: "08:00" }] };
  assert.deepEqual(parseBriefContent(JSON.stringify(content)), content);
  assert.deepEqual(parseBriefContent("```json\n" + JSON.stringify(content) + "\n```"), content);
  assert.throws(() => parseBriefContent(JSON.stringify({ ...content, focus: null })));
  assert.throws(() => parseBriefContent(JSON.stringify({ ...content, events: [null] })));
  assert.throws(() => parseBriefContent("not json"));
  assert.equal(parseBriefContent(JSON.stringify({ ...content, summary: "a".repeat(1000) })).summary.length, 600);
  assert.equal(parseBriefContent(JSON.stringify({ ...content, todos: Array(100).fill(content.focus) })).todos.length, 12);
});

test("focus links reject external hosts, credentials and URL suffixes while preserving saved briefs", () => {
  const content = { summary: "Summary", focus: { title: "Review", body: "Review sources" }, todos: [], updates: [], events: [] };
  const safe = "https://github.com/owner/repo/pull/42";
  const sourceUrls = ["https://evil.example/owner/repo/pull/42", "https://user:secret@github.com/owner/repo/pull/42", `${safe}?token=secret`, `${safe}#discussion`, "javascript:alert(1)"];
  for (const invalid of sourceUrls) {
    const parsed = parseBriefContent(JSON.stringify({ ...content, focus: { ...content.focus, sourceUrls: [invalid, safe] } }));
    assert.deepEqual(parsed.focus.links, [{ title: safe, url: safe }]);
  }
  const accepted = parseBriefContent(JSON.stringify({ ...content, focus: { ...content.focus, sourceUrls: [safe] } }));
  assert.deepEqual(accepted.focus.links, [{ title: safe, url: safe }]);
  assert.deepEqual(parseBriefContent(JSON.stringify(accepted)), accepted);
  assert.deepEqual(parseBriefContent(JSON.stringify(content)), content);
});

test("update sources only retain exact GitHub PR and Gmail message links", () => {
  const base = { summary: "Summary", focus: { title: "Focus", body: "Body" }, todos: [], updates: [], events: [] };
  const safe = [{ kind: "github", url: "https://github.com/owner/repo/pull/42", project: "repo" }, { kind: "gmail", url: "https://mail.google.com/mail/u/0/#all/abc123def456" }];
  for (const source of safe) {
    const content = { ...base, updates: [{ title: "Update", body: "Body", source }] };
    assert.deepEqual(parseBriefContent(JSON.stringify(content)), content);
  }
  for (const sourceUrl of ["https://evil.example/mail/u/0/#all/abc123", "https://user:secret@mail.google.com/mail/u/0/#all/abc123", "https://mail.google.com/mail/u/0/#all/abc123?token=secret", "https://github.com/owner/repo/pull/42#discussion", "https://mail.google.com/mail/u/0/#all/../../evil"]) {
    const parsed = parseBriefContent(JSON.stringify({ ...base, updates: [{ title: "Update", body: "Body", sourceUrl }] }));
    assert.deepEqual(parsed.updates, [{ title: "Update", body: "Body" }]);
  }
});


test("Gmail links select the connected account and reject extra query parameters", () => {
  const url = gmailBriefUrl("second+brief@example.com", "abc123def456");
  assert.equal(url, "https://mail.google.com/mail/u/?authuser=second%2Bbrief%40example.com#all/abc123def456");
  assert.equal(isSafeBriefSource({ kind: "gmail", url }), true);
  assert.equal(isSafeBriefSource({ kind: "gmail", url: "https://mail.google.com/mail/u/0/#all/abc123def456" }), true);
  for (const invalid of [
    url.replace("#all", "&redirect=https://evil.example#all"),
    url.replace("authuser=", "authuser=other%40example.com&authuser="),
    url.replace("second%2Bbrief%40example.com", "not-an-email"),
    url.replace("second%2Bbrief%40example.com", "%ZZ"),
    url.replace("mail.google.com", "user:secret@mail.google.com"),
    url.replace("#all", "#inbox"),
    url + "?token=secret",
  ]) assert.equal(isSafeBriefSource({ kind: "gmail", url: invalid }), false);
  assert.equal(gmailBriefUrl(undefined, "abc123"), undefined);
  assert.equal(gmailBriefUrl("person@example.com", "../../bad"), undefined);
  const content = { summary: "Summary", focus: { title: "Focus", body: "Body" }, todos: [], updates: [{ title: "Mail", body: "Read", source: { kind: "gmail", url } }], events: [] };
  assert.deepEqual(parseBriefContent(JSON.stringify(content)), content);
});


test("legacy item urls and Gmail focus links survive parsing", () => {
  const url = gmailBriefUrl("person@example.com", "abc123def456");
  const parsed = parseBriefContent(JSON.stringify({ summary: "Summary", focus: { title: "Mail", body: "Read", url, sourceUrls: [url] }, todos: [{ title: "Mail", body: "Read", url }], updates: [], events: [] }));
  assert.deepEqual(parsed.focus.source, { kind: "gmail", url });
  assert.deepEqual(parsed.focus.links, [{ title: url, url, kind: "gmail" }]);
  assert.deepEqual(parsed.todos[0].source, { kind: "gmail", url });
});

test("brief summaries omit the repeated date and stay short at word boundaries", () => {
  assert.equal(briefSummary("Sunday, October 25: No meetings. Review your PR."), "No meetings. Review your PR.");
  assert.equal(briefSummary("October 25, 2026 — Clear your inbox."), "Clear your inbox.");
  assert.equal(briefSummary("First sentence. Second sentence. Third sentence."), "First sentence. Second sentence.");
  const text = briefSummary("Review the " + "important changes ".repeat(20));
  assert.ok(text.length <= 160);
  assert.match(text, /(?:changes|important)…$/);
});


test("focus popup only lists PRs explicitly mentioned in its visible text", () => {
  const first = { title: "First PR", url: "https://github.com/owner/repo/pull/192" };
  const second = { title: "Second PR", url: "https://github.com/owner/repo/pull/193" };
  const email = { title: "Related email", kind: "gmail", url: "https://mail.google.com/mail/u/?authuser=person%40example.com#all/abc123def456" };
  const focus = { title: "Prepare PR #192", body: "Read the review.", links: [first, second, email] };
  assert.deepEqual(focusDisplayLinks(focus), [first]);
  assert.deepEqual(focusDisplayLinks({ ...focus, body: "Read #193 too." }), [first, second]);
  assert.deepEqual(focusDisplayLinks({ ...focus, title: "Prepare pull request192" }), [first]);
  assert.deepEqual(focusDisplayLinks({ ...focus, title: "Prepare the PRs" }), []);
  assert.deepEqual(focusDisplayLinks({ ...focus, title: "Read this email", links: [email] }), [email]);
  const parsed = parseBriefContent(JSON.stringify({ summary: "Summary", focus, todos: [], updates: [], events: [] }));
  assert.deepEqual(focusDisplayLinks(parsed.focus), [first]);
});

test("focus popup excludes ambiguous PR numbers unless the repository is explicit", () => {
  const first = { title: "First PR", url: "https://github.com/owner/repo/pull/192" };
  const second = { title: "Other PR", url: "https://github.com/another/project/pull/192" };
  const focus = { title: "Prepare PR #192", body: "Read the review.", links: [first, second] };
  assert.deepEqual(focusDisplayLinks(focus), []);
  assert.deepEqual(focusDisplayLinks({ ...focus, body: "In owner/repo." }), [first]);
  assert.deepEqual(focusDisplayLinks({ ...focus, body: first.url }), [first]);
  assert.deepEqual(focusDisplayLinks({ ...focus, title: "Prepare PR #1920" }), []);
});


test("focus popup respects an explicit repository even when only the wrong PR is cited", () => {
  const first = { title: "Fix sidebar clipping during live resize", url: "https://github.com/owner/repo/pull/192" };
  const second = { title: "Repair calendar permission handling", url: "https://github.com/other/repo/pull/193" };
  assert.deepEqual(focusDisplayLinks({ title: "Prepare other/repo PR #192", body: "Read the review.", links: [first] }), []);
  assert.deepEqual(focusDisplayLinks({ title: "Prepare owner/repo PR #192", body: "Read the review.", links: [first] }), [first]);
  assert.deepEqual(focusDisplayLinks({ title: "Prepare the PRs", body: "Read the review.", links: [first, second] }), []);
  assert.deepEqual(focusDisplayLinks({ title: "Prepare the PRs", body: "Check Fix sidebar clipping during live resize.", links: [first, second] }), [first]);
  assert.deepEqual(focusDisplayLinks({ title: "Prepare the PRs", body: "Check Fix sidebar clipping during live resize and Repair calendar permission handling.", links: [first, second] }), []);
});

test("meeting times use local readable start and range for structured and legacy timestamps", async () => {
  const { briefEventTime } = await import("./briefContent.ts");
  const event = { title: "Bachs Intro", body: "15-minute introductory call via Google Meet.", time: "raw", start: "2026-10-25T17:00:00.000Z", end: "2026-10-25T17:15:00.000Z" };
  assert.deepEqual(briefEventTime(event, "Africa/Lagos"), { start: "6:00pm", range: "6:00 PM – 6:15 PM", body: event.body });
  assert.equal(briefEventTime({ ...event, start: undefined, end: undefined, time: "2026-10-25T07:00:00.000Z" }, "Africa/Lagos").start, "8:00am");
  assert.deepEqual(briefEventTime({ title: "Call", time: "2026-10-25 04:45–05:45 UTC", body: "The supplied timestamps are in UTC; no local timezone was provided." }, "Africa/Lagos"), { start: "5:45am", range: "5:45 AM – 6:45 AM", body: "1-hour calendar event." });
  assert.equal(briefEventTime({ ...event, allDay: true }).start, "All day");
  assert.equal(briefEventTime({ title: "Call", body: "Invitation pending.", time: "invalid" }).start, "TBD");
});
