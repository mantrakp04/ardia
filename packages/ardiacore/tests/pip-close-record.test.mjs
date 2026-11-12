import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
const engine = (name) => read(`../../../engine/ardiacore/src/ardia/core/${name}`);

const observer = engine("ac_picture_in_picture.mm");
const windowHost = engine("ac_window_host.mm");
const tabMedia = engine("ardiacore_tab_media.mm");
const pipNative = read("../ios/ArdiaWebView+PictureInPicture.mm");
const painting = read("../ios/ArdiaWebView+Painting.mm");
const hostBridge = read("../ios/ArdiaHost.mm");

const body = (source, signature) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} exists`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${signature} has no end`);
};

test("the engine records every Picture in Picture close without the pip trace", () => {
  const exit = body(observer, "void OnExitPictureInPicture() override");
  assert.match(exit, /TakeExitRequest\(\)/);
  assert.match(exit, /RecordClose\(opener_\.get\(\), kind_, entered_auto_, by_app\)/);
  assert.match(exit, /Report\(opener_, false, kind_, by_app \? @"app" : @"chrome", entered_auto_\)/);
  assert.ok(exit.indexOf("RecordClose(") > exit.lastIndexOf("PictureInPictureTracing()"), "the record is written outside the trace block");
  assert.ok(exit.indexOf("RecordClose(") < exit.indexOf("if (!opener_)"), "the record is written even when the opener is gone");

  const record = body(observer, "void RecordClose(");
  assert.doesNotMatch(record, /PictureInPictureTracing|Traced\(/);
  for (const field of ["by=%s", "kind=%s", "enteredAuto=%d", "chromeAuto=%d", "hostShown=%d", "activations=[%s]"]) {
    assert.ok(record.includes(field), `the close record has ${field}`);
  }
  assert.match(record, /IsInAutoPictureInPicture\(\)/);
  assert.match(record, /ShownByHost\(opener\)/);
  assert.match(record, /kCloseRecordLimit/);
  assert.match(observer, /constexpr size_t kCloseRecordLimit = \d+;/);
  assert.match(observer, /constexpr size_t kActivationNoteLimit = \d+;/);
});

test("the engine keeps the last window-activation changes with the window and its age, bounded", () => {
  const note = body(observer, "void NoteWindowActivation(");
  assert.doesNotMatch(note, /PictureInPictureTracing|Traced\(/);
  assert.match(note, /kActivationNoteLimit/);
  assert.match(body(observer, "std::string RecentActivations("), /window=%ld ageMs=%ld/);
  assert.match(observer, /entered_auto_ = helper && helper->IsInAutoPictureInPicture\(\)/);
});

test("both window-activation paths in the window host note the change", () => {
  assert.match(body(windowHost, "void ActivateExclusively("), /NoteWindowActivation\("activate exclusively", target->ns_window\(\)\.windowNumber\)/);
  const widget = body(windowHost, "void WindowHost::OnWidgetActivationChanged(");
  assert.match(widget, /NoteWindowActivation\(active \? "widget active" : "widget inactive"/);
  assert.ok(widget.indexOf("NoteWindowActivation") < widget.indexOf("ActivateExclusively("), "the change is noted before the other windows are deactivated");
  assert.equal((windowHost.match(/ActivateExclusively\(this, browser\)/g) ?? []).length, 2);
});

test("a close the app asked for is told apart from one Chrome started", () => {
  assert.match(body(tabMedia, "exitPictureInPicture"), /NotePictureInPictureExitRequested\(\)[\s\S]*ExitPictureInPicture\(\)/);
  assert.match(observer, /by_app \? @"app" : @"chrome"/);
});

test("the native exit branch and the sight rule record their reasons without the pip trace", () => {
  const note = body(pipNative, "- (void)notePictureInPictureSight:");
  assert.doesNotMatch(note, /TracingPictureInPicture/);
  for (const field of ["seenByUser=%d", "visible=%d", "appActive=%d", "key=%d"]) {
    assert.ok(note.includes(field), `the sight note has ${field}`);
  }
  assert.match(note, /NSApp\.isActive/);
  assert.match(note, /isKeyWindow/);
  assert.match(note, /ardia_host::NoteFocusChange\(/);

  const update = body(pipNative, "- (void)updateAutoPictureInPicture");
  assert.match(update, /else if \(_reports\.seenByUser[^{]*\{\s*\[self notePictureInPictureSight:@"exit requested"\];\s*_reports\.autoPictureInPictureActive = NO;\s*\[self exitPictureInPicture\];/);

  const sight = body(painting, "- (void)userSightChanged");
  assert.match(sight, /notePictureInPictureSight:seen \? @"sight seen" : @"sight left"/);
  assert.ok(sight.indexOf("notePictureInPictureSight") < sight.indexOf("updateAutoPictureInPicture"));
  assert.doesNotMatch(sight.slice(sight.indexOf("notePictureInPictureSight") - 160, sight.indexOf("notePictureInPictureSight")), /TracingPictureInPicture/);
});

test("the close reaches the page as closedBy and auto, and the record reaches Copy Diagnostics", () => {
  const change = body(pipNative, "- (void)tab:(ArdiaCoreTab *)tab didChangePictureInPicture:");
  assert.match(change, /payload\[@"closedBy"\] = state\[@"closedBy"\]/);
  assert.match(change, /payload\[@"auto"\]/);
  assert.match(hostBridge, /@"pictureInPictureCloses" : engine\.pictureInPictureCloses/);
  assert.match(engine("ardiacore_engine.mm"), /- \(NSString\*\)pictureInPictureCloses \{\s*return NS\(PictureInPictureCloseRecord\(\)\);/);
  assert.match(engine("public/ArdiaCore.h"), /@property\(readonly\) NSString\* pictureInPictureCloses;/);
});
