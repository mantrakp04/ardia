import assert from "node:assert/strict";
import { test } from "node:test";
const { motionStep, tallPage } = await import("./toolbarMotion.ts");

test("hiding: the layout jumps to the strip at once and the page, bar and controls glide up together", () => {
  assert.deepEqual(motionStep("shown", "collapsed", false), { set: { laid: 1 }, glide: { page: 1, bar: 1, fade: 1 }, show: false, fit: null });
});

test("showing mirrors hiding and fits the page under the bar once the glide ends", () => {
  assert.deepEqual(motionStep("collapsed", "shown", false), { set: { laid: 0 }, glide: { page: 0, bar: 0, fade: 0 }, show: true, fit: "afterGlide" });
  assert.deepEqual(motionStep("peek", "shown", false), { set: { laid: 0 }, glide: { page: 0, bar: 0, fade: 0 }, show: true, fit: "afterGlide" });
});

test("a peek from the shown bar keeps the page's room and shows the controls", () => {
  assert.deepEqual(motionStep("shown", "peek", false), { set: { laid: 1 }, glide: { page: 1, bar: 0, fade: 0 }, show: false, fit: null });
});

test("peeking from the strip shows the bar over the page in one frame, and leaving the peek glides it away", () => {
  assert.deepEqual(motionStep("collapsed", "peek", false), { set: { bar: 0, fade: 0 }, glide: {}, show: false, fit: null });
  assert.deepEqual(motionStep("peek", "collapsed", false), { set: {}, glide: { bar: 1, fade: 1 }, show: false, fit: null });
});

test("Reduce Motion: the page and band move at once and only the controls fade", () => {
  assert.deepEqual(motionStep("shown", "collapsed", true), { set: { laid: 1, page: 1, bar: 1 }, glide: { fade: 1 }, show: false, fit: null });
  assert.deepEqual(motionStep("collapsed", "shown", true), { set: { laid: 0, page: 0, bar: 0 }, glide: { fade: 0 }, show: true, fit: "now" });
  assert.deepEqual(motionStep("peek", "collapsed", true), { set: { bar: 1 }, glide: { fade: 1 }, show: false, fit: null });
  assert.deepEqual(motionStep("collapsed", "peek", true), { set: { bar: 0, fade: 0 }, glide: {}, show: false, fit: null });
});

test("no change of mode moves nothing", () => {
  for (const mode of ["shown", "peek", "collapsed"]) assert.equal(motionStep(mode, mode, false), null);
});

test("the page grows to the strip's size in the render that first collapses the bar", () => {
  const was = { on: false, doc: "a" };
  assert.deepEqual(tallPage(was, { enabled: true, collapsed: true, doc: "a" }), { on: true, doc: "a" });
  assert.equal(tallPage(was, { enabled: true, collapsed: false, doc: "a" }), was);
  assert.equal(tallPage(was, { enabled: false, collapsed: true, doc: "a" }), was);
});

test("the page stays tall while the bar shows again, until the show is done", () => {
  const tall = { on: true, doc: "a" };
  assert.equal(tallPage(tall, { enabled: true, collapsed: false, doc: "a" }), tall);
  assert.equal(tallPage(tall, { enabled: true, collapsed: true, doc: "a" }), tall);
});

test("a new document or turning hiding off fits the page at once", () => {
  const tall = { on: true, doc: "a" };
  assert.deepEqual(tallPage(tall, { enabled: true, collapsed: false, doc: "b" }), { on: false, doc: "b" });
  assert.deepEqual(tallPage(tall, { enabled: false, collapsed: false, doc: "a" }), { on: false, doc: "a" });
  assert.deepEqual(tallPage(tall, { enabled: true, collapsed: true, doc: "b" }), { on: true, doc: "b" });
});
