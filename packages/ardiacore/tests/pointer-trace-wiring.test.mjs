import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const focusState = read("../ios/ArdiaFocusState.mm");
const host = read("../ios/ArdiaHost.mm");
const hostHeader = read("../ios/ArdiaHost.h");
const internal = read("../ios/ArdiaInternal.h");
const pip = read("../ios/ArdiaPictureInPicture.mm");
const pipHeader = read("../ios/ArdiaPictureInPicture.h");
const dragRegion = read("../../shell/ios/WindowDragRegion.swift");
const windowMove = read("../../shell/ios/WindowMove.swift");

test("Copy Diagnostics focus block carries the pointer lines", () => {
  assert.match(focusState, /\[lines addObjectsFromArray:PointerLines\(\)\]/);
  for (const line of ["pointer buttons", "pointer pip grabbed", "pointer modal", "pointer sheet", "pointer window"]) {
    assert.ok(focusState.includes(line), line);
  }
  assert.match(focusState, /NSEvent\.pressedMouseButtons/);
  assert.match(focusState, /currentRunLoop\.currentMode/);
  assert.match(focusState, /ardia_pip::GrabbedWindow\(\)/);
  assert.match(focusState, /NSApp\.modalWindow/);
  assert.match(focusState, /window\.attachedSheet/);
  assert.match(focusState, /DescribeFrame\(window\.frame\)/);
  assert.match(focusState, /window\.level/);
});

test("engineInfo still publishes the focus block", () => {
  assert.match(host, /@"focus" : ardia_host::FocusState\(\)/);
});

test("left down and up are recorded by a passive monitor", () => {
  assert.match(focusState, /addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown \| NSEventMaskLeftMouseUp/);
  assert.match(focusState, /NotePointer\(event, nil\);\s*return event;/);
});

test("the press loops open and close the flag", () => {
  const clickOrDrag = dragRegion.slice(dragRegion.indexOf("private func clickOrDrag"));
  assert.match(clickOrDrag, /ArdiaHost\.beginPressLoop\("windowDragRegion"\)\s*defer \{ ArdiaHost\.endPressLoop\(\) \}/);
  const follow = windowMove.slice(windowMove.indexOf("static func follow"));
  assert.ok(follow.indexOf("following = true") < follow.indexOf('ArdiaHost.beginPressLoop("windowMove")'));
  assert.ok(follow.indexOf('ArdiaHost.beginPressLoop("windowMove")') < follow.indexOf("ArdiaHost.endPressLoop()"));
  assert.ok(follow.indexOf("ArdiaHost.endPressLoop()") < follow.indexOf("following = false"));
});

test("the swallowing monitors report the events they consume", () => {
  assert.equal(dragRegion.match(/ArdiaHost\.notePointer\(event, swallowedBy: "windowDragRegion"\)/g).length, 2);
  assert.equal(pip.match(/ardia_host::NotePointer\(event, @"pipDrag"\)/g).length, 2);
  assert.match(pipHeader, /NSWindow \*GrabbedWindow\(\);/);
  assert.match(pip, /NSWindow \*GrabbedWindow\(\) \{ return gDragged; \}/);
});

test("Swift reaches the trace through ArdiaHost", () => {
  for (const selector of ["beginPressLoop:", "endPressLoop", "notePointer:"]) {
    assert.ok(hostHeader.includes(`+ (void)${selector}`), selector);
  }
  for (const name of ["BeginPressLoop", "EndPressLoop", "NotePointer"]) {
    assert.ok(host.includes(`ardia_host::${name}(`), name);
    assert.ok(internal.includes(`${name}(`), name);
  }
});
