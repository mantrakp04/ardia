import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const media = await import("./media.ts");

const S = () => useBrowser.getState();
const M = () => media.useMedia.getState();
const report = (overrides = {}) => ({
  title: "Song", artist: "Band", album: "", artwork: null, playbackState: "playing", position: 10, duration: 200,
  playbackRate: 1, timestamp: Date.now(), hasVideo: false, actions: ["play", "pause"], controllable: true, ...overrides,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

async function twoPlaying() {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });
  const sent = [];
  for (const id of [b, c]) webviews.set(id, { mediaCommand: async (action) => void sent.push([id, action]) });
  media.setNowPlaying(b, report());
  await tick();
  media.setNowPlaying(c, report());
  let shown = media.playerTabFor(M(), [b, c]);
  const player = () => (shown = media.playerTabFor(M(), [b, c], shown));
  return { b, c, sent, player };
}

test("pausing the tab the sidebar player shows keeps the player on it", async () => {
  const { b, c, sent, player } = await twoPlaying();
  assert.equal(player(), c);

  media.mediaCommand(c, "toggle");
  assert.deepEqual(sent, [[c, "toggle"]]);
  assert.equal(M().sessions[c].playbackState, "playing", "nothing changes until the page reports it");
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  assert.equal(player(), c, "paused, while the other tab still plays");

  media.setNowPlaying(c, null);
  assert.equal(player(), b, "its session ended: the next one");
  for (const id of [b, c]) webviews.delete(id);
});

test("a late playing report doesn't move the sidebar player", async () => {
  const { b, c, player } = await twoPlaying();
  assert.equal(player(), c);
  media.mediaCommand(c, "pause");
  const playedAt = M().sessions[c].playedAt;
  media.setNowPlaying(c, report({ position: 11 }));
  assert.equal(player(), c);
  assert.equal(M().sessions[c].playedAt, playedAt, "still the same play, not a new one");
  media.setNowPlaying(c, report({ playbackState: "paused", position: 11 }));
  assert.equal(player(), c);
  media.setNowPlaying(c, report({ position: 11 }));
  assert.equal(player(), c);
  assert.equal(M().sessions[b].playbackState, "playing");
  for (const id of [b, c]) webviews.delete(id);
});

test("closing the sidebar player hands it to the next tab", async () => {
  const { b, c, player } = await twoPlaying();
  assert.equal(player(), c);
  media.useMedia.setState({ dismissed: { [c]: true } });
  assert.equal(player(), b);
  for (const id of [b, c]) webviews.delete(id);
});

test("media that never played with sound gets no sidebar player until it does", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const feed = S().newTab(w, { url: "x.com", background: true });
  const pick = () => media.playerTabFor(M(), [feed]);
  media.setNowPlaying(feed, report({ title: "Home / X", controllable: false }));
  assert.equal(pick(), undefined, "muted autoplay");
  media.setNowPlaying(feed, report({ title: "Home / X", playbackState: "paused", controllable: false }));
  assert.equal(pick(), undefined, "paused muted autoplay");
  media.setNowPlaying(feed, report({ title: "Home / X", controllable: true }));
  assert.equal(pick(), feed, "unmuted while playing");
  assert.ok(M().sessions[feed].playedAt > 0);
  media.setNowPlaying(feed, report({ title: "Home / X", controllable: false }));
  assert.equal(pick(), undefined, "another muted video took over the page");
});

test("play on a sleeping tab reloads it and resumes where it paused", async () => {
  const { useLifecycle } = await import("../tabs/sleepingTabs.ts");
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com", background: true });
  const sent = [];
  let reloads = 0;
  webviews.set(b, { reload: async () => void reloads++, mediaCommand: async (action, seconds) => void sent.push([action, seconds]) });
  media.setNowPlaying(b, report());
  media.setNowPlaying(b, report({ playbackState: "paused", position: 95 }));
  useLifecycle.setState({ discarded: { [b]: true } });

  media.mediaCommand(b, "toggle");
  media.mediaCommand(b, "play");
  media.mediaCommand(b, "next");
  assert.equal(reloads, 1, "one reload however often it's pressed");
  assert.deepEqual(sent, [], "nothing goes to a page that isn't there");

  useLifecycle.setState({ discarded: {} });
  media.setNowPlaying(b, null);
  media.setNowPlaying(b, report({ playbackState: "paused", position: 0, controllable: false }));
  assert.deepEqual(sent, [["seekTo", 95], ["play", undefined]]);
  media.setNowPlaying(b, report({ playbackState: "paused", position: 95 }));
  assert.equal(sent.length, 2, "it resumes once");
  media.setNowPlaying(b, null);
  webviews.delete(b);
});

test("a woken page that plays on its own, or plays something else, isn't sought", () => {
  const before = { ...report({ playbackState: "paused", position: 95 }), playedAt: 1 };
  assert.deepEqual(media.resumeCommands(before, report({ playbackState: "playing", position: 0 })), []);
  assert.deepEqual(media.resumeCommands(before, report({ title: "Other", playbackState: "paused", position: 0 })), [["play"]]);
  assert.deepEqual(media.resumeCommands(before, report({ playbackState: "paused", position: 93 })), [["play"]]);
  assert.deepEqual(media.resumeCommands(undefined, report({ playbackState: "paused", position: 0 })), [["play"]]);
});

test("play on a sleeping tab whose page reports no media session still resumes once the page has loaded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { useLifecycle } = await import("../tabs/sleepingTabs.ts");
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com", background: true });
  const sent = [];
  webviews.set(b, { reload: async () => {}, mediaCommand: async (action, seconds) => void sent.push([action, seconds]) });
  media.setNowPlaying(b, report());
  media.setNowPlaying(b, report({ playbackState: "paused", position: 95 }));
  useLifecycle.setState({ discarded: { [b]: true } });

  media.mediaCommand(b, "toggle");
  useLifecycle.setState({ discarded: {} });
  media.setNowPlaying(b, null);
  S().updateLive(b, { isLoading: true });
  t.mock.timers.tick(5000);
  assert.deepEqual(sent, [], "nothing while the page loads");
  S().updateLive(b, { isLoading: false });
  t.mock.timers.tick(5000);
  assert.deepEqual(sent, [["seekTo", 95], ["play", undefined]], "a plain <video> with no MediaSession reports nothing until it plays");
  webviews.delete(b);
});
