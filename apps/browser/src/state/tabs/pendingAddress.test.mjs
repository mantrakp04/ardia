import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitsFirstPage, firstPagePending, noteFirstPagePending, reachableByAnotherPage, reportedAddress, reportedTitle } from "./pendingAddress.ts";

const SLOW = "https://slow.example/release";
const appTab = { adoptId: undefined, openedByPage: false };
const linkTab = { adoptId: "link:0", openedByPage: false };
const pageTab = { adoptId: "ardiacore:8", openedByPage: true };

test("a tab the app made keeps its pending address after the app's own script or capture touched its blank document", () => {
  const touched = { url: SLOW, initialDocumentAccessed: true, committedInitial: true };
  assert.deepEqual(reportedAddress(touched, appTab), { url: SLOW, untouched: true });
  assert.deepEqual(reportedAddress(touched, linkTab), { url: SLOW, untouched: true });
  assert.deepEqual(reportedAddress({ ...touched, url: "" }, appTab), { url: "", untouched: true });
});

test("a tab another page can reach says about:blank once its blank document was touched", () => {
  assert.deepEqual(reportedAddress({ url: SLOW, initialDocumentAccessed: true, committedInitial: true }, pageTab), { url: "about:blank", untouched: false });
  assert.deepEqual(reportedAddress({ url: "", initialDocumentAccessed: true, committedInitial: true }, { adoptId: "tab:3", openedByPage: false }), { url: "about:blank", untouched: false });
  assert.deepEqual(reportedAddress({ url: SLOW, initialDocumentAccessed: false, committedInitial: true }, pageTab), { url: SLOW, untouched: true });
});

test("a committed page reports its own address whoever opened it", () => {
  for (const tab of [appTab, linkTab, pageTab]) assert.deepEqual(reportedAddress({ url: "about:blank", initialDocumentAccessed: true, committedInitial: false }, tab), { url: "about:blank", untouched: false });
  assert.deepEqual(reportedAddress({ url: SLOW, initialDocumentAccessed: false, committedInitial: false }, pageTab), { url: SLOW, untouched: false });
});

test("an engine that reports no initial document holds a blank report only for a tab no page opened", () => {
  assert.equal(reportedAddress({ url: "" }, appTab).untouched, true);
  assert.equal(reportedAddress({ url: "" }, pageTab).untouched, false);
  assert.equal(reportedAddress({ url: SLOW }, appTab).untouched, false);
});

test("only tabs the app made itself are out of another page's reach", () => {
  assert.equal(reachableByAnotherPage(undefined), false);
  assert.equal(reachableByAnotherPage("link:2"), false);
  assert.equal(reachableByAnotherPage("restore:t1"), false);
  for (const id of ["ardiacore:1", "tab:1", "clone:t1", "webkit:1"]) assert.equal(reachableByAnotherPage(id), true, id);
});

test("a first page is pending while the initial document loads toward a real address", () => {
  assert.equal(firstPagePending({ url: SLOW, committedInitial: true, isLoading: true }), true);
  assert.equal(firstPagePending({ url: SLOW, committedInitial: false, isLoading: true }), false);
  assert.equal(firstPagePending({ url: SLOW, committedInitial: true, isLoading: false }), false);
  assert.equal(firstPagePending({ url: "about:blank", committedInitial: true, isLoading: true }), false);
  noteFirstPagePending("t1", true);
  assert.equal(awaitsFirstPage("t1"), true);
  noteFirstPagePending("t1", false);
  assert.equal(awaitsFirstPage("t1"), false);
});

test("the blank page's title never names a tab whose address is a real one", () => {
  assert.equal(reportedTitle("about:blank", SLOW), "");
  assert.equal(reportedTitle("about:blank", "about:blank"), "about:blank");
  assert.equal(reportedTitle("about:blank", ""), "about:blank");
  assert.equal(reportedTitle("Timetable", SLOW), "Timetable");
  assert.equal(reportedTitle("", SLOW), "");
});
