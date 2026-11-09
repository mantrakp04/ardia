import test from "node:test";
import assert from "node:assert/strict";
import { effectiveAttention, overlayAttentionAction, goalReady, previewDocument, safeSource, sanitizePreview, type AttentionItem } from "./attention-model.ts";
const item = (extra: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "test:1", kind: "task", status: "open", resume_status: "open", snooze_until: null,
  label: "Check the fix", preview_html: "<p>Needs a look</p>", report: "Check the source.",
  goal_label: null, goal_preview_html: null, goal_report: null, last_tracked_at: null, progress: null,
  source_links: [], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  status_at: "2026-01-01T00:00:00.000Z", pinned_at: null, ...extra,
});
test("expired task snoozes return without a routine run", () => {
  const r = item({ status: "snoozed", snooze_until: "2026-01-02T00:00:00.000Z" });
  assert.equal(effectiveAttention(r, Date.parse("2026-01-01T00:00:00Z")).status, "snoozed");
  assert.equal(effectiveAttention(r, Date.parse("2026-01-03T00:00:00Z")).status, "open");
});
test("expired pinned snoozes return to goals", () => {
  assert.equal(effectiveAttention(item({ status: "snoozed", resume_status: "pinned", snooze_until: "2026-01-02T00:00:00Z" }), Date.parse("2026-01-03T00:00:00Z")).status, "pinned");
});
test("a pin needs a rewritten goal after the pin time", () => {
  const r = item({ status: "pinned", pinned_at: "2026-02-01T00:00:00Z", goal_label: "Ship the fix", goal_report: "Next: verify", goal_preview_html: "<progress value='50'></progress>", last_tracked_at: "2026-01-01T00:00:00Z" });
  assert.equal(goalReady(r), false);
  assert.equal(goalReady({ ...r, last_tracked_at: "2026-02-02T00:00:00Z" }), true);
});
test("preview HTML cannot load remote content, run handlers or navigate", () => {
  const html = sanitizePreview('<meta http-equiv="refresh" content="0;url=https://evil.test"><script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="https://evil.test"><div class="chip" onclick="alert(1)">Okay</div><a href="https://evil.test">link</a><progress value="50" max="100"></progress>');
  assert.equal(html, 'alert(1)<div class="chip">Okay</div>link<progress max="100" value="50"></progress>');
  const doc = previewDocument(html);
  assert.ok(doc.includes("default-src 'none'"));
  assert.ok(!doc.includes("evil.test"));
  assert.ok(!doc.includes("<script"));
});
test("source links exclude script URLs and protocol-relative navigation", () => {
  assert.equal(safeSource("javascript:alert(1)"), false);
  assert.equal(safeSource("//evil.test"), false);
  assert.equal(safeSource("/health"), true);
  assert.equal(safeSource("https://github.com/mantrakp04/ardia/issues/1"), true);
});

test("the latest snooze restores a pin even before the routine has pulled the earlier pin", () => {
  const saved = item();
  const snapshot = item({ status: "pinned", pinned_at: "2026-01-02T00:00:00.000Z" });
  const r = overlayAttentionAction(saved, snapshot, "snoozed", "2026-01-03T00:00:00.000Z", "2026-01-04T00:00:00.000Z");
  assert.equal(r.resume_status, "pinned");
  assert.equal(r.pinned_at, snapshot.pinned_at);
  assert.equal(effectiveAttention(r, Date.parse("2026-01-05T00:00:00Z")).status, "pinned");
});
test("an old action cannot undo the routine's newer completion", () => {
  const saved = item({ status: "done", status_at: "2026-01-04T00:00:00.000Z" });
  assert.equal(overlayAttentionAction(saved, item(), "pinned", "2026-01-02T00:00:00.000Z", null).status, "done");
});
