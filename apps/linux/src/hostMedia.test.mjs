import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HostPageEvents } from "./hostPageEvents.ts";
import { resetHostPage } from "./hostPageLifecycle.ts";
import { CLOSE_DOCUMENT_PICTURE_IN_PICTURE, PICTURE_IN_PICTURE_STATE, UNSAVED_WORK, hostPageScript } from "./hostPageScripts.ts";
import { startLinuxTabPolicies, watchInputIdle } from "./hostPolicies.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { pageOf, patchPage } from "../../browser/src/state/tabs/pageState.ts";
import { updateLive } from "../../browser/src/state/tabs/actions.ts";
import { playerTabFor, setNowPlaying, setPictureInPictureState, useMedia } from "../../browser/src/state/media/media.ts";
import { noteDiscarded, noteReady, useLifecycle } from "../../browser/src/state/tabs/tabLifecycle.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const lease = { claim: "claim", rendererGeneration: "2", bindingGeneration: "3", documentEpoch: "1" };
const event = (name, data) => ({ name, data });
const message = (sequence, name, data) => ({ ...lease, type: "pageEvent", sequence, event: event(name, data) });
const nowPlaying = {
  title: "Track", artist: "Artist", album: "Album", artwork: "https://media.ardia.test/art.png", playbackState: "playing",
  position: 12, duration: 200, playbackRate: 1, timestamp: 1700000000000, hasVideo: true, actions: ["play", "pause", "nexttrack"], controllable: true,
};

function setup() {
  useBrowser.getState().hydrate({});
  const window = useBrowser.getState().createWindow({ url: "https://media.ardia.test/" });
  const tab = useBrowser.getState().windows[window].tabIds[0];
  const calls = [];
  const props = {
    onMedia: ({ playing, muted }) => { calls.push(["media", playing, muted]); updateLive(tab, { playingAudio: playing }); },
    onNowPlaying: (state) => { calls.push(["nowPlaying", state]); setNowPlaying(tab, state); },
    onMediaAccess: (access) => { calls.push(["mediaAccess", access]); patchPage(tab, { mediaAccess: access.camera || access.microphone || access.screen ? access : null }); },
    onPictureInPicture: (state) => { calls.push(["pictureInPicture", state]); setPictureInPictureState(tab, state); },
    onDiscarded: (url) => { calls.push(["discarded", url]); noteDiscarded(tab); },
    onReady: () => { calls.push(["ready"]); noteReady(tab); },
  };
  const receiver = new HostPageEvents("claim", () => 7, () => props, (reason, replaced) => resetHostPage(tab, reason, replaced), () => {});
  return { tab, calls, receiver, send: (value) => receiver.receive("ArdiaWebView", "7", value) };
}

const mediaSnapshot = (playing, access, pip, extra = []) => [
  event("navigation", { url: "https://media.ardia.test/", title: "Media", canGoBack: false, canGoForward: false, isLoading: false, themeColor: null, themeColorSource: null }),
  event("security", { level: "insecure", url: "https://media.ardia.test/", origin: null }),
  event("media", { playing, muted: false }),
  event("nowPlaying", { state: playing ? nowPlaying : null }),
  event("mediaAccess", access),
  event("pictureInPicture", pip),
  ...extra,
];

test("snapshot media state reaches the shared audio badge, player, capture and picture-in-picture state", () => {
  const h = setup();
  assert.ok(h.receiver.install({ lease, snapshot: { watermark: 1, events: mediaSnapshot(true, { camera: true, microphone: false, screen: false }, { kind: "video", active: true }) } }));
  assert.equal(useBrowser.getState().live[h.tab]?.playingAudio, true);
  assert.equal(useMedia.getState().sessions[h.tab]?.title, "Track");
  assert.deepEqual(useMedia.getState().sessions[h.tab]?.actions, ["play", "pause", "nexttrack"]);
  assert.deepEqual(pageOf(h.tab).mediaAccess, { camera: true, microphone: false, screen: false });
  assert.equal(useMedia.getState().pipOpen[h.tab], "video");
  h.send(message(2, "media", { playing: false, muted: true }));
  h.send(message(3, "nowPlaying", { state: null }));
  h.send(message(4, "pictureInPicture", { kind: "video", active: false }));
  assert.equal(useBrowser.getState().live[h.tab]?.playingAudio, false);
  assert.equal(useMedia.getState().sessions[h.tab], undefined);
  assert.equal(useMedia.getState().pipOpen[h.tab], undefined);
  assert.deepEqual(pageOf(h.tab).mediaAccess, { camera: true, microphone: false, screen: false });
});

test("a playing video outside the media session offers the video controls but no player", () => {
  const h = setup();
  assert.ok(h.receiver.install({ lease, snapshot: { watermark: 1, events: [] } }));
  const video = { title: "Clips", artist: "", album: "", artwork: null, playbackState: "playing", position: 0, duration: null, playbackRate: 1, timestamp: 1700000000000, hasVideo: true, actions: [], controllable: false };
  h.send(message(2, "nowPlaying", { state: video }));
  const media = useMedia.getState();
  assert.equal(media.sessions[h.tab]?.hasVideo, true, "Site Controls and the hover card gate Picture in Picture on hasVideo");
  assert.equal(playerTabFor(media, [h.tab]), undefined, "a muted video gets no player tile");
  h.send(message(3, "nowPlaying", { state: null }));
  assert.equal(useMedia.getState().sessions[h.tab], undefined);
});

test("a restore snapshot replaces media access and a document snapshot replays it", () => {
  const h = setup();
  assert.ok(h.receiver.install({ lease, snapshot: { watermark: 1, events: [] } }));
  h.send(message(2, "mediaAccess", { camera: false, microphone: true, screen: false }));
  assert.deepEqual(pageOf(h.tab).mediaAccess, { camera: false, microphone: true, screen: false });
  h.send({ ...lease, type: "pageLifecycle", sequence: 3, action: "snapshot", reason: "restore", events: [event("mediaAccess", { camera: false, microphone: false, screen: false })] });
  assert.equal(pageOf(h.tab).mediaAccess, null);
  h.send({ ...lease, documentEpoch: "2", type: "pageLifecycle", sequence: 4, action: "snapshot", reason: "document",
    events: mediaSnapshot(false, { camera: false, microphone: false, screen: true }, { kind: "document", active: true }) });
  assert.deepEqual(pageOf(h.tab).mediaAccess, { camera: false, microphone: false, screen: true });
  assert.equal(useMedia.getState().pipOpen[h.tab], "document");
});

test("discarded and ready page events drive the shared sleeping state, including a rebind snapshot", () => {
  const h = setup();
  assert.ok(h.receiver.install({ lease, snapshot: { watermark: 1, events: [] } }));
  h.send(message(2, "discarded", { url: "https://media.ardia.test/page" }));
  assert.equal(useLifecycle.getState().discarded[h.tab], true);
  h.send(message(3, "ready", {}));
  assert.equal(useLifecycle.getState().discarded[h.tab], undefined);
  const rebind = { browserId: 9, chromeTabId: 9, lease: { ...lease, bindingGeneration: "4" }, snapshot: { watermark: 1, events: mediaSnapshot(false, { camera: false, microphone: false, screen: false }, { kind: "video", active: false }, [event("discarded", { url: "https://media.ardia.test/swapped" })]) } };
  assert.ok(h.send({ ...lease, type: "pageLifecycle", sequence: 4, action: "rebind", creation: rebind }));
  assert.equal(useLifecycle.getState().discarded[h.tab], true);
  assert.deepEqual(h.calls.filter(([name]) => name === "discarded").map(([, url]) => url), ["https://media.ardia.test/page", "https://media.ardia.test/swapped"]);
});

test("known shared page scripts map to native commands and unknown scripts stay unmapped", () => {
  assert.deepEqual(hostPageScript("evaluate", [PICTURE_IN_PICTURE_STATE]), { command: "pictureInPictureState", args: [] });
  assert.deepEqual(hostPageScript("executeJavaScript", [CLOSE_DOCUMENT_PICTURE_IN_PICTURE]), { command: "exitPictureInPicture", args: [] });
  assert.equal(hostPageScript("evaluate", [CLOSE_DOCUMENT_PICTURE_IN_PICTURE]), null);
  assert.equal(hostPageScript("executeJavaScript", [PICTURE_IN_PICTURE_STATE]), null);
  assert.equal(hostPageScript("evaluate", ["document.title"]), null);
  assert.equal(hostPageScript("evaluate", [PICTURE_IN_PICTURE_STATE, 1]), null);
  const media = source("../../browser/src/state/media/media.ts");
  assert.ok(media.includes(`const PIP_STATE = '${PICTURE_IN_PICTURE_STATE}';`), "the shared PiP probe changed; update hostPageScripts.ts");
  assert.ok(media.includes(`view.executeJavaScript("${CLOSE_DOCUMENT_PICTURE_IN_PICTURE}")`), "the shared document PiP close changed; update hostPageScripts.ts");
  const edited = hostPageScript("evaluate", [UNSAVED_WORK]);
  assert.equal(edited.command, "editedInput");
  assert.deepEqual(edited.args, []);
  assert.equal(edited.map(false), false, "no edits means nothing to keep");
  assert.equal(edited.map(true), true);
  assert.equal(edited.map(null), true, "unknown asks before moving the page");
  assert.equal(hostPageScript("executeJavaScript", [UNSAVED_WORK]), null);
  const engines = source("../../browser/src/state/engines/actions.ts");
  assert.ok(engines.includes(`const UNSAVED_WORK = \`${UNSAVED_WORK}\`;`), "the shared unsaved-work probe changed; update hostPageScripts.ts");
  const webView = source("./shims/web/HostWebView.tsx");
  assert.ok(webView.indexOf("hostPageScript(property, args)") < webView.indexOf("current.command(property, args)"));
  assert.ok(webView.includes("script.map ? current.command(script.command, script.args).then(script.map, () => (script.failed ? script.failed() : script.map!(null)))"), "a mapped page script treats a refused command as unknown unless it has its own failure handler");
});

test("input idle tracks shell input and the policies start once with one inputIdleSeconds provider", () => {
  let clock = 1000;
  const listeners = new Map();
  const target = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const idle = watchInputIdle(target, () => clock);
  clock += 4500;
  assert.equal(idle.seconds(), 4.5);
  listeners.get("pointermove")();
  assert.equal(idle.seconds(), 0);
  idle.stop();
  assert.equal(listeners.size, 0);

  const providers = [];
  let lifecycles = 0;
  let trims = 0;
  const deps = {
    target, now: () => clock,
    provide: (provider) => { providers.push(provider); return () => providers.splice(providers.indexOf(provider), 1); },
    startLifecycle: () => ++lifecycles, startTrim: () => ++trims,
  };
  const stop = startLinuxTabPolicies(deps);
  assert.equal(startLinuxTabPolicies(deps), stop);
  assert.equal(lifecycles, 1);
  assert.equal(trims, 1);
  assert.equal(providers.length, 1);
  const read = providers[0]("ArdiaEngine", "inputIdleSeconds");
  assert.equal(typeof read, "function");
  clock += 3000;
  assert.equal(read(), 3);
  assert.equal(providers[0]("ArdiaEngine", "trimMemory"), undefined);
  assert.equal(providers[0]("ArdiaShell", "inputIdleSeconds"), undefined);
  const main = source("./main.tsx");
  const policies = main.indexOf("startLinuxTabPolicies(");
  assert.ok(policies > main.indexOf("} else {") && policies < main.indexOf("startLinuxAppServices({"), "tab policies start only in browser windows");
});
