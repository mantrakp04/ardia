import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_ARCHIVE_INTERVALS, isAutoArchiveDue, POSITION_STEP } from "./tabModels.ts";
import {
  archiveTabs,
  clearArchive,
  closeAllTabs,
  closeTab,
  deckOrder,
  emptyTabs,
  launchTabs,
  openTab,
  reopenLastClosed,
  restoreArchived,
  runAutoArchive,
  selectTab,
  updateTab,
  withArchive,
  type TabsData,
} from "./tabsState.ts";

let ids = 0;
const nextId = () => `T${++ids}`;

function opened(data: TabsData, url: string, at: number, extra: { isPrivate?: boolean; after?: string } = {}) {
  return openTab(data, { url, origin: "typed", isPrivate: extra.isPrivate ?? false, after: extra.after }, at, nextId());
}

function threeTabs() {
  let data = emptyTabs();
  const a = opened(data, "https://a.example/", 1);
  data = a.change.data;
  const b = opened(data, "https://b.example/", 2);
  data = b.change.data;
  const c = opened(data, "https://c.example/", 3);
  data = c.change.data;
  return { data, a: a.tab, b: b.tab, c: c.tab };
}

test("opening a tab appends it, selects it and writes it", () => {
  const { change, tab } = opened(emptyTabs(), "https://a.example/", 10);
  assert.equal(change.data.selectedId, tab.id);
  assert.deepEqual(change.data.open.map((t) => t.url), ["https://a.example/"]);
  assert.equal(tab.position, 0);
  assert.ok(change.put.some((t) => t.id === tab.id));
  const second = opened(change.data, "https://b.example/", 11);
  assert.equal(second.tab.position, POSITION_STEP);
});

test("a tab opened after another goes between it and the next one", () => {
  const { data, a, b } = threeTabs();
  const { change, tab } = opened(data, "https://after-a.example/", 4, { after: a.id });
  assert.ok(tab.position > a.position && tab.position < b.position);
  assert.deepEqual(change.data.open.map((t) => t.id).slice(0, 2), [a.id, tab.id]);
});

test("selecting a tab touches both the old and the new tab", () => {
  const { data, a, c } = threeTabs();
  const change = selectTab(data, a.id, 50);
  assert.equal(change.data.selectedId, a.id);
  assert.equal(change.data.open.find((t) => t.id === a.id)!.lastActive, 50);
  assert.equal(change.data.open.find((t) => t.id === c.id)!.lastActive, 50);
  assert.equal(change.put.length, 2);
});

test("closing the selected tab archives it and selects its neighbour", () => {
  const { data, b, c } = threeTabs();
  const selectedB = selectTab(data, b.id, 4).data;
  const change = closeTab(selectedB, b.id, 5);
  assert.deepEqual(change.endedPages, [b.id]);
  assert.equal(change.data.selectedId, c.id);
  assert.equal(change.data.archivedCount, 1);
  assert.equal(change.put.find((t) => t.id === b.id)!.archivedAt, 5);
  assert.equal(change.data.undo.length, 1);
});

test("closing the last tab leaves nothing selected", () => {
  const only = opened(emptyTabs(), "https://a.example/", 1);
  const change = closeTab(only.change.data, only.tab.id, 2);
  assert.equal(change.data.selectedId, null);
  assert.equal(change.data.open.length, 0);
});

test("reopening a closed tab puts it back where it was and selects it", () => {
  const { data, b } = threeTabs();
  const closed = closeTab(selectTab(data, b.id, 4).data, b.id, 5).data;
  const { change, reopened } = reopenLastClosed(closed, 6);
  assert.equal(reopened[0]!.id, b.id);
  assert.equal(change.data.selectedId, b.id);
  assert.equal(change.data.open[1]!.id, b.id);
  assert.equal(change.data.open[1]!.archivedAt, null);
  assert.equal(change.data.archivedCount, 0);
  assert.equal(change.data.undo.length, 0);
});

test("private tabs stay out of the store and out of the regular order", () => {
  const { data } = threeTabs();
  const { change, tab } = opened(data, "https://secret.example/", 9, { isPrivate: true });
  assert.ok(tab.isPrivate);
  assert.equal(tab.profileSyncId, null);
  assert.equal(change.put.filter((t) => t.isPrivate).length, 0);
  assert.equal(change.data.privates.length, 1);
  assert.equal(change.data.open.length, 3);
  assert.equal(deckOrder(change.data).at(-1)!.id, tab.id);
  const closed = closeTab(change.data, tab.id, 10);
  assert.equal(closed.data.privates.length, 0);
  assert.equal(closed.data.archivedCount, 0);
  assert.deepEqual(closed.endedPages, [tab.id]);
  assert.equal(closed.data.selectedId, change.data.open.at(-1)!.id);
});

test("a tab opened after a private tab is private too", () => {
  const first = opened(emptyTabs(), "https://secret.example/", 1, { isPrivate: true });
  const second = opened(first.change.data, "https://link.example/", 2, { after: first.tab.id });
  assert.ok(second.tab.isPrivate);
});

test("updating a private tab writes nothing", () => {
  const first = opened(emptyTabs(), "https://secret.example/", 1, { isPrivate: true });
  const change = updateTab(first.change.data, first.tab.id, { title: "Secret" });
  assert.equal(change.data.privates[0]!.title, "Secret");
  assert.equal(change.put.length, 0);
});

test("updating with the same values changes nothing", () => {
  const { data, a } = threeTabs();
  const change = updateTab(data, a.id, { url: a.url, title: undefined });
  assert.equal(change.data, data);
});

test("close all archives every regular tab and ends every private one", () => {
  const { data } = threeTabs();
  const withPrivate = opened(data, "https://secret.example/", 9, { isPrivate: true }).change.data;
  const change = closeAllTabs(withPrivate, 10);
  assert.equal(change.data.open.length, 0);
  assert.equal(change.data.privates.length, 0);
  assert.equal(change.data.archivedCount, 3);
  assert.equal(change.endedPages.length, 4);
  assert.equal(change.data.selectedId, null);
});

test("auto archive leaves the tab being viewed and fresh tabs alone", () => {
  const { data, a, b, c } = threeTabs();
  const day = AUTO_ARCHIVE_INTERVALS.day!;
  const aged: TabsData = { ...data, open: data.open.map((t) => (t.id === c.id ? t : { ...t, lastActive: 0 })) };
  const change = runAutoArchive(aged, "day", day + 1);
  assert.deepEqual(change.data.open.map((t) => t.id), [c.id]);
  assert.deepEqual(new Set(change.endedPages), new Set([a.id, b.id]));
  assert.equal(change.data.undo.length, 0);
  assert.equal(runAutoArchive(aged, "never", day * 100).data, aged);
  assert.equal(isAutoArchiveDue(0, day * 2, "day", true), false);
});

test("an archived tab restores at the end and becomes the selected tab", () => {
  const { data, a } = threeTabs();
  const archived = archiveTabs(data, [a.id], false, 5);
  const loaded = withArchive(archived.data, archived.put.filter((t) => t.archivedAt !== null));
  assert.equal(loaded.archive!.length, 1);
  const change = restoreArchived(loaded, loaded.archive![0]!, 6);
  assert.equal(change.data.open.at(-1)!.id, a.id);
  assert.equal(change.data.selectedId, a.id);
  assert.equal(change.data.archive!.length, 0);
  assert.equal(change.data.archivedCount, 0);
});

test("clearing the archive keeps undo groups only for open tabs", () => {
  const { data, a } = threeTabs();
  const closed = closeTab(data, a.id, 5).data;
  const change = clearArchive(closed);
  assert.equal(change.clearArchived, true);
  assert.equal(change.data.undo.length, 0);
  assert.equal(change.data.archivedCount, 0);
});

test("launch selects the most recently active tab", () => {
  const { data, b } = threeTabs();
  const tabs = data.open.map((t) => (t.id === b.id ? { ...t, lastActive: 99 } : t));
  assert.equal(launchTabs([...tabs].reverse(), 0).selectedId, b.id);
  assert.deepEqual(launchTabs([...tabs].reverse(), 0).open.map((t) => t.position), [0, POSITION_STEP, 2 * POSITION_STEP]);
});
