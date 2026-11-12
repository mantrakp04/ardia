import assert from "node:assert/strict";
import { test } from "node:test";
import { noteLoadAsked, openingPage, shapedPageEvent } from "../../../../packages/expo-windows/src/engine/pageEvents.ts";

const ZIP = "https://github.com/octocat/Hello-World/archive/refs/heads/master.zip";
const PAGE = "http://example.com/links.html";
const navigation = (url, committedUrl, isLoading, title = committedUrl) => ({ url, committedUrl, isLoading, title, canGoBack: false, canGoForward: false });
const shaped = (page, name, data) => shapedPageEvent(page, name, data);

test("a tab that has only its opening blank page reports it as the initial document, with no address or title", () => {
  const page = openingPage("", false);
  const first = shaped(page, "navigation", navigation("about:blank", "", true, ""));
  assert.deepEqual([first.url, first.title, first.committedInitial, first.initialDocumentAccessed], ["", "", true, false]);
  const settled = shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.deepEqual([settled.url, settled.title, settled.committedInitial], ["", "", true]);
  const loading = shaped(page, "navigation", navigation(ZIP, "about:blank", true));
  assert.deepEqual([loading.url, loading.title, loading.committedInitial], [ZIP, "", true]);
});

test("a download from a tab with no page yet says nothing was committed, so the tab goes back to empty", () => {
  const page = openingPage("", false);
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  shaped(page, "navigation", navigation(ZIP, "about:blank", true));
  const download = shaped(page, "downloadNavigation", { url: ZIP, committedUrl: "about:blank", skipped: false });
  assert.deepEqual(download, { url: ZIP, committedUrl: "", skipped: false });
  const after = shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.deepEqual([after.url, after.title, after.isLoading], ["", "", false]);
});

test("a download typed into a tab that opens on it leaves no page, though the engine still shows its address", () => {
  const page = openingPage(ZIP, false);
  const loading = shaped(page, "navigation", navigation(ZIP, "", true, ""));
  assert.deepEqual([loading.url, loading.isLoading], [ZIP, true]);
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: ZIP, skipped: false }).committedUrl, "");
  const after = shaped(page, "navigation", navigation(ZIP, "", false, ""));
  assert.deepEqual([after.url, after.title, after.isLoading, after.committedInitial], ["", "", false, true]);
});

test("after such a download the next address typed into the tab shows while it loads, and its page stays", () => {
  const page = openingPage(ZIP, false);
  shaped(page, "navigation", navigation(ZIP, "", true, ""));
  shaped(page, "downloadNavigation", { url: ZIP, committedUrl: ZIP, skipped: false });
  shaped(page, "navigation", navigation(ZIP, "", false, ""));
  noteLoadAsked(page, PAGE);
  assert.equal(shaped(page, "navigation", navigation(PAGE, "", true, "")).url, PAGE);
  assert.equal(shaped(page, "navigation", navigation(PAGE, "", false, "")).url, PAGE);
  assert.equal(shaped(page, "navigation", navigation(PAGE, PAGE, false, "links")).url, PAGE);
});

test("a load that stops without a download keeps its address", () => {
  const page = openingPage(PAGE, false);
  shaped(page, "navigation", navigation(PAGE, "", true, ""));
  assert.equal(shaped(page, "navigation", navigation(PAGE, "", false, "")).url, PAGE);
});

test("a download from a loaded page keeps that page", () => {
  const page = openingPage("", false);
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  const loaded = shaped(page, "navigation", navigation(PAGE, PAGE, false, "links"));
  assert.deepEqual([loaded.url, loaded.title, loaded.committedInitial], [PAGE, "links", undefined]);
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: PAGE, skipped: false }).committedUrl, PAGE);
  const back = shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.deepEqual([back.url, back.committedInitial], ["about:blank", undefined]);
});

test("about:blank asked for by address is shown as about:blank", () => {
  const typed = openingPage("", false);
  noteLoadAsked(typed, "about:blank");
  assert.equal(shaped(typed, "navigation", navigation("about:blank", "about:blank", false)).url, "about:blank");
  const opened = openingPage("about:blank", false);
  assert.equal(shaped(opened, "navigation", navigation("about:blank", "about:blank", false)).url, "about:blank");
});

test("a tab the engine opened keeps its own blank document, and closes on a download", () => {
  const page = openingPage("", true);
  const blank = shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.deepEqual([blank.url, blank.committedInitial], ["about:blank", undefined]);
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: "about:blank", skipped: false }).committedUrl, "");
  assert.equal(shaped(page, "navigation", navigation(ZIP, "about:blank", false)).url, "");
});

test("a download from about:blank asked for by address keeps about:blank", () => {
  const page = openingPage("about:blank", false);
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: "", skipped: false }).committedUrl, "about:blank");
  const after = shaped(page, "navigation", navigation("", "about:blank", false, ""));
  assert.deepEqual([after.url, after.title, after.committedInitial], ["about:blank", "about:blank", undefined]);
});

test("a download from about:blank asked for by address keeps about:blank from an engine that already says so", () => {
  const page = openingPage("about:blank", false);
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: "about:blank", skipped: false }).committedUrl, "about:blank");
  assert.equal(shaped(page, "navigation", navigation("about:blank", "about:blank", false)).url, "about:blank");
});

test("a tab opened blank and then asked for about:blank keeps about:blank after a download", () => {
  const page = openingPage("", false);
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  noteLoadAsked(page, "about:blank");
  shaped(page, "navigation", navigation("about:blank", "about:blank", false));
  assert.equal(shaped(page, "downloadNavigation", { url: ZIP, committedUrl: "", skipped: false }).committedUrl, "about:blank");
  const loading = shaped(page, "navigation", navigation(ZIP, "about:blank", true));
  assert.equal(loading.url, ZIP);
  const after = shaped(page, "navigation", navigation("", "about:blank", false, ""));
  assert.deepEqual([after.url, after.title], ["about:blank", "about:blank"]);
});

test("a navigation event without a committed address is passed through, and media keeps its shape", () => {
  const page = openingPage("", false);
  const event = { url: "about:blank", title: "about:blank", isLoading: false };
  assert.deepEqual(shaped(page, "navigation", event), event);
  assert.deepEqual(shaped(page, "media", { audible: true }), { playing: true, muted: false });
  assert.deepEqual(shaped(page, "ready", null), {});
});
