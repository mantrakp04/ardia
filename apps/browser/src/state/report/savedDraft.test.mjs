import assert from "node:assert/strict";
import { test } from "node:test";

const { restoredDraft, savedDraftJson, savedDraftOf } = await import("./savedDraft.ts");
const { initialReportState } = await import("./store.ts");

const identity = { id: "11111111-2222-4333-8444-555555555555", kind: "one-time", name: "Brave Otter", avatar: { colors: ["#000", "#111", "#222"], angle: 30 } };
const created = { id: "FB-7KQ2", name: "Brave Otter", token: "tok", uploadUrls: { "recording.mp4": "https://ardia.dev/api/feedback/FB-7KQ2/files/recording.mp4" }, uploaded: [] };
const recording = { phase: "ready", path: "/drafts/a/recording.mp4", thumbnail: "/drafts/a/recording-1.png", seconds: 16, bytes: 146_000, includePages: false };

const filled = (over = {}) => ({
  ...initialReportState(),
  windowId: "w1",
  draftDir: "/drafts/a",
  draft: { ...initialReportState().draft, title: "t", description: "fd" },
  recording,
  ...over,
});

const roundTrip = (state, exists = () => true, who = identity) => {
  const saved = savedDraftOf(state, who);
  return saved ? restoredDraft(savedDraftJson(saved), exists) : null;
};

test("an empty sheet and a sent report save nothing", () => {
  assert.equal(savedDraftOf(initialReportState(), null), null);
  assert.equal(savedDraftOf(filled({ sent: { id: "FB-7KQ2" } }), identity), null);
});

test("a draft with its recording comes back after a relaunch", () => {
  const restored = roundTrip(filled());
  assert.equal(restored.draft.title, "t");
  assert.equal(restored.draft.description, "fd");
  assert.equal(restored.draftDir, "/drafts/a");
  assert.deepEqual(restored.recording, recording);
  assert.deepEqual(restored.upload, { phase: "idle" });
  assert.equal(restored.identity, null);
});

test("a failed send comes back failed, with its report to resume and the same identity", () => {
  const upload = { phase: "failed", stage: "upload", message: "x", created, errorClass: "storage", status: 502, attempts: 3 };
  const restored = roundTrip(filled({ upload }));
  assert.equal(restored.upload.phase, "failed");
  assert.equal(restored.upload.stage, "upload");
  assert.equal(restored.upload.errorClass, "storage");
  assert.deepEqual(restored.upload.created, created);
  assert.match(restored.upload.message, /couldn't store this right now/);
  assert.deepEqual(restored.identity, identity);
});

test("a recording deleted while Ardia was closed is dropped, the words stay", () => {
  const restored = roundTrip(filled(), (path) => !path.endsWith(".mp4"));
  assert.deepEqual(restored.recording, { phase: "none" });
  assert.equal(restored.draft.description, "fd");
});

test("a recording alone is worth keeping, an in-progress one is not", () => {
  const blank = initialReportState().draft;
  assert.ok(savedDraftOf(filled({ draft: blank }), null));
  assert.equal(savedDraftOf(filled({ draft: blank, recording: { phase: "recording", seconds: 3, includePages: false } }), null), null);
});

test("damaged or unknown saved drafts are ignored", () => {
  assert.equal(restoredDraft(null, () => true), null);
  assert.equal(restoredDraft("{not json", () => true), null);
  assert.equal(restoredDraft(JSON.stringify({ version: 1, draft: { kind: "rant" } }), () => true), null);
  assert.equal(restoredDraft(JSON.stringify({ version: 9, draft: { kind: "bug" } }), () => true), null);
  const odd = restoredDraft(JSON.stringify({ version: 1, draft: { kind: "idea", title: 5, attach: { page: true } }, pending: { stage: "nope" } }), () => true);
  assert.equal(odd.draft.title, "");
  assert.equal(odd.draft.attach.page, true);
  assert.equal(odd.draft.attach.system, true);
  assert.deepEqual(odd.upload, { phase: "idle" });
});
