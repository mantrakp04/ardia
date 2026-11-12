import assert from "node:assert/strict";
import { test } from "node:test";

const form = await import("./form.ts");

const draft = (patch = {}) => ({ ...form.emptyDraft(), title: "Tabs flicker", description: "They flicker after sleep.", ...patch });

const context = (patch = {}) => ({
  installId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
  sessionId: "01900000-0000-7000-8000-000000000000",
  appVersion: "0.2.47",
  appBuild: "247",
  channel: "nightly",
  osVersion: "27.2",
  arch: "arm64",
  pageAddress: "https://ardia.dev/release-notes?ref=x",
  sharing: false,
  diagnostics: { system: { app: "Ardia 0.2.47" } },
  files: [],
  ...patch,
});

test("the title counter counts what a person sees, not UTF-16 units", () => {
  assert.equal(form.characterCount("abc"), 3);
  assert.equal(form.characterCount("é"), 1);
  assert.equal(form.characterCount("é"), 1);
  assert.equal(form.characterCount("👍🏽"), 1);
  assert.equal(form.characterCount("🇵🇹"), 1);
  assert.equal(form.characterCount("👩‍💻 bug"), 5);
});

test("the counter turns full at 67 and near ten before", () => {
  assert.deepEqual(form.titleCounter("x".repeat(56)), { count: 56, max: 67, full: false, near: false });
  assert.equal(form.titleCounter("x".repeat(57)).near, true);
  assert.equal(form.titleCounter("x".repeat(67)).full, true);
});

test("the title stops at 67 characters and never splits one", () => {
  assert.equal(form.clampTitle("x".repeat(80)).length, 67);
  const accented = "é".repeat(40);
  const clamped = form.clampTitle(accented);
  assert.equal(form.characterCount(clamped), 33);
  assert.ok(Array.from(clamped).length <= 67);
  assert.ok(clamped.endsWith("é"));
  assert.equal(form.clampTitle("👍🏽".repeat(70)), "👍🏽".repeat(33));
});

test("a pasted title loses its line breaks and control characters", () => {
  assert.equal(form.clampTitle("one\ntwo\r\nthree\u0007"), "one two three ");
});

test("the description stops at 4000 and contact at 200", () => {
  assert.equal(form.clampDescription("a".repeat(5000)).length, 4000);
  assert.equal(form.clampContact("a".repeat(300)).length, 200);
});

test("Send needs a title and a description, spaces alone don't count", () => {
  assert.equal(form.canSend(draft()), true);
  assert.deepEqual(form.draftProblems(draft({ title: "   " })), ["title"]);
  assert.deepEqual(form.draftProblems(draft({ description: "\n\n" })), ["description"]);
  assert.deepEqual(form.draftProblems(draft({ title: "", description: "" })), ["title", "description"]);
  assert.deepEqual(form.draftProblems(draft({ title: "x".repeat(68) })), ["titleTooLong"]);
});

test("each missing or too-long field gets its own hint, and filled ones get none", () => {
  const titleOnly = form.draftProblems(draft({ description: "" }));
  assert.equal(form.fieldProblem(titleOnly, "title"), null);
  assert.deepEqual(form.fieldProblem(titleOnly, "description"), { problem: "description", hint: "Say what happened to send" });
  const empty = form.draftProblems(draft({ title: "", description: "" }));
  assert.equal(form.fieldProblem(empty, "title").hint, "Add a title to send");
  assert.equal(form.fieldProblem(empty, "description").problem, "description");
  assert.equal(form.fieldProblem(empty, "contact"), null);
  assert.equal(form.fieldProblem(form.draftProblems(draft({ title: "x".repeat(68) })), "title").hint, "Shorten the title to 67 characters");
  assert.equal(form.fieldProblem(form.draftProblems(draft({ description: "x".repeat(4001) })), "description").hint, "Shorten this to 4,000 characters");
  assert.equal(form.fieldProblem(form.draftProblems(draft({ contact: "x".repeat(201) })), "contact").problem, "contactTooLong");
  assert.deepEqual(form.draftProblems(draft()), []);
});

test("the payload follows the contract and leaves out what isn't ticked", () => {
  const payload = form.buildPayload(draft({ title: "  Tabs flicker  ", contact: "" }), context());
  assert.deepEqual(Object.keys(payload).sort(), [
    "app_build", "app_version", "arch", "attachments", "channel", "description", "diagnostics", "install_id", "kind", "os_version", "session_id", "source", "title", "watch_days",
  ]);
  assert.equal(payload.title, "Tabs flicker");
  assert.equal(payload.source, "app");
  assert.equal(payload.kind, "bug");
  assert.equal(payload.watch_days, 0);
  assert.equal("page_address" in payload, false);
  assert.equal("contact" in payload, false);
});

test("the page address and contact go only when given", () => {
  const payload = form.buildPayload(draft({ contact: " @me ", attach: { ...form.DEFAULT_ATTACH, page: true } }), context());
  assert.equal(payload.page_address, "https://ardia.dev/release-notes?ref=x");
  assert.equal(payload.contact, "@me");
  assert.equal(form.buildPayload(draft({ attach: { ...form.DEFAULT_ATTACH, page: true } }), context({ pageAddress: null })).page_address, undefined);
});

test("watch days are 14 when sharing or when the watch is ticked, else 0", () => {
  assert.equal(form.buildPayload(draft(), context()).watch_days, 0);
  assert.equal(form.buildPayload(draft({ watch: true }), context()).watch_days, 14);
  assert.equal(form.buildPayload(draft(), context({ sharing: true })).watch_days, 14);
});

test("attachments list name, bytes and type only", () => {
  const files = [{ name: "recording.mp4", path: "/x/recording.mp4", bytes: 1234, type: "video/mp4" }];
  assert.deepEqual(form.buildPayload(draft(), context({ files })).attachments, [{ name: "recording.mp4", bytes: 1234, type: "video/mp4" }]);
});

test("the description keeps line breaks and tabs, drops other control characters", () => {
  const payload = form.buildPayload(draft({ description: "a\r\nb\tc\u0000d" }), context());
  assert.equal(payload.description, "a\nb\tcd");
});

test("diagnostics stay under 64 KB by dropping whole sections", () => {
  const big = { system: { app: "x" }, huge: "y".repeat(70 * 1024), settings: { a: "1" } };
  const capped = form.capDiagnostics(big);
  assert.deepEqual(Object.keys(capped), ["system", "settings"]);
});

test("durations and sizes read the way the sheet shows them", () => {
  assert.equal(form.formatDuration(7.9), "0:07");
  assert.equal(form.formatDuration(61), "1:01");
  assert.equal(form.formatBytes(900), "900 B");
  assert.equal(form.formatBytes(2048), "2 KB");
  assert.equal(form.formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(form.watchEndDate(0), 14 * 86_400_000);
});

test("without Intl.Segmenter (Hermes) the fallback splits the same way for common text", () => {
  for (const text of ["abc", "éx", "👍🏽ok", "🇵🇹🇧🇷", "👩‍💻 bug", "naïve café", "日本語"]) {
    assert.deepEqual(form.fallbackGraphemes(text), [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment), text);
  }
});
