import assert from "node:assert/strict";
import { test } from "node:test";
const { watchDocument, stopDocumentWatch, watchedDocuments } = await import("./documentWatch.ts");

const tick = () => new Promise((r) => setTimeout(r, 0));

function fakeTab() {
  const tab = { loading: true, holding: true, same: true, released: 0, ports: [] };
  tab.port = () => {
    const port = {
      polls: 0,
      holds: () => tab.holding,
      loading: () => tab.loading,
      sameDocument: async () => {
        port.polls++;
        return tab.same;
      },
      release: () => tab.released++,
      wait: tick,
    };
    tab.ports.push(port);
    return port;
  };
  return tab;
}

test("ten load starts in a row leave one watcher polling the tab", async () => {
  const tab = fakeTab();
  const watchers = Array.from({ length: 10 }, () => watchDocument("t1", tab.port(), 250));
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(tab.ports.slice(0, 9).map((p) => p.polls), [1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.ok(tab.ports[9].polls >= 4);
  assert.equal(watchedDocuments(), 1);
  tab.loading = false;
  await Promise.all(watchers);
  assert.equal(watchedDocuments(), 0);
});

test("a load that stops and starts again within one poll keeps only the new watcher", async () => {
  const tab = fakeTab();
  const first = tab.port();
  const old = watchDocument("t2", first, 250);
  await tick();
  stopDocumentWatch("t2");
  const second = tab.port();
  const fresh = watchDocument("t2", second, 250);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(first.polls, 1);
  assert.ok(second.polls >= 4);
  tab.same = false;
  await Promise.all([old, fresh]);
  assert.equal(tab.released, 1);
  assert.equal(watchedDocuments(), 0);
});

test("watchers of different tabs don't stop each other", async () => {
  const a = fakeTab();
  const b = fakeTab();
  const pa = a.port();
  const pb = b.port();
  const wa = watchDocument("ta", pa, 250);
  const wb = watchDocument("tb", pb, 250);
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(watchedDocuments(), 2);
  a.loading = false;
  b.loading = false;
  await Promise.all([wa, wb]);
  assert.ok(pa.polls >= 2 && pb.polls >= 2);
});
