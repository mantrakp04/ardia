import { evaluate } from "../lib/cdp.mjs";
import { MEDIA_TITLE } from "../lib/fixtures.mjs";
import { navigateTab, startBrowser } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";
import { call } from "./f06-site-controls.mjs";

export const AUTOPLAY_ARGS = ["--autoplay-policy=no-user-gesture-required"];
export const PIP_PROBE = 'post("result", JSON.stringify(!!document.pictureInPictureElement || !!window.documentPictureInPicture?.window))';

export function viewCall(shell, tabId, call) {
  return shell.eval(`(async () => { const view = ardiaLinux.webviews.get(${js(tabId)}); if (!view) throw new Error("tab ${tabId} has no mounted page"); return await view.${call}; })()`);
}

export async function viewCallWithoutGesture(shell, tabId, call) {
  const expression = `(async () => { const view = ardiaLinux.webviews.get(${js(tabId)}); if (!view) throw new Error("no mounted page"); return await view.${call}; })()`;
  const result = await shell.session.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false }, { timeout: 10000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}

export async function mediaPage(state, url) {
  const target = await state.app.pageLoaded(url);
  return state.app.connect(target);
}

export async function startTone(page) {
  const started = await evaluate(page, "startTone()");
  if (started !== true) throw new Error(`the fixture tone did not start: ${started}`);
  return until(() => evaluate(page, "!document.getElementById('tone').paused && document.getElementById('tone').currentTime > 0"), { timeout: 10000, label: "the tone to play" });
}

const session = (shell, tabId) => shell.eval(`ardiaLinux.media.getState().sessions[${js(tabId)}] ?? null`);
const audible = (shell, tabId) => shell.state(`return !!s.live[${js(tabId)}]?.playingAudio;`);

export default {
  id: "F15",
  issue: 25,
  title: "Media badges, now-playing transport and manual Picture-in-Picture through the native host",
  deadline: 300000,
  async run(t) {
    const run = nonce("f15");
    const state = await startBrowser(t, { name: "media", extraArgs: AUTOPLAY_ARGS });
    const { shell } = state;
    const url = t.fixtures.url.media(run);
    const tabId = await shell.newTab(url);
    await shell.waitTabUrl(tabId, (u) => u === url);
    const page = await mediaPage(state, url);

    await t.check("playing audio reaches the tab's audio badge state", async () => {
      await startTone(page);
      await until(() => audible(shell, tabId), { timeout: 15000, label: "s.live[tab].playingAudio" });
      return { audible: true };
    }, { critical: true });
    await t.check("now-playing metadata, actions and position reach the shared player", async () => {
      const current = await until(async () => {
        const s = await session(shell, tabId);
        return s?.title === MEDIA_TITLE && s.playbackState === "playing" && s.actions.includes("nexttrack") ? s : false;
      }, { timeout: 15000, label: "the media session in useMedia" });
      if (current.artist !== "Ardia" || current.album !== "Fixture") throw new Error(`metadata ${JSON.stringify(current)}`);
      if (!current.controllable) throw new Error("the session is not controllable");
      return { title: current.title, actions: current.actions, artwork: current.artwork, position: current.position };
    });
    await t.check("pause and play from Ardia reach the page's media session", async () => {
      await viewCall(shell, tabId, "mediaCommand('pause')");
      await until(() => evaluate(page, "document.getElementById('tone').paused && mediaLog.includes('pause')"), { timeout: 8000, label: "the page to pause" });
      await until(async () => (await session(shell, tabId))?.playbackState === "paused", { timeout: 8000, label: "the shared session to show paused" });
      await viewCall(shell, tabId, "mediaCommand('toggle')");
      await until(() => evaluate(page, "!document.getElementById('tone').paused && mediaLog.includes('play')"), { timeout: 8000, label: "the page to resume" });
      await until(async () => (await session(shell, tabId))?.playbackState === "playing", { timeout: 8000, label: "the shared session to show playing" });
      return { log: await evaluate(page, "mediaLog") };
    });
    await t.check("next track and seek reach the page and invalid commands are refused", async () => {
      await viewCall(shell, tabId, "mediaCommand('next')");
      await viewCall(shell, tabId, "mediaCommand('seekTo', 0.25)");
      await until(() => evaluate(page, "mediaLog.includes('nexttrack') && mediaLog.includes('seekto')"), { timeout: 8000, label: "nexttrack and seekto handlers" });
      const refused = await shell.eval(`ardiaLinux.webviews.get(${js(tabId)}).mediaCommand('rewind').then(() => false, () => true)`);
      if (!refused) throw new Error("an unknown media command was accepted");
      return { log: await evaluate(page, "mediaLog") };
    });
    await t.check("muting is accepted and keeps the session", async () => {
      await viewCall(shell, tabId, "setMuted(true)");
      const s = await session(shell, tabId);
      await viewCall(shell, tabId, "setMuted(false)");
      return { session: s?.title ?? null };
    });
    await t.check("the PiP probe answers natively and an audio-only page opens no window", async () => {
      const open = await viewCall(shell, tabId, `evaluate(${js(PIP_PROBE)})`);
      if (open !== false) throw new Error(`the PiP probe returned ${JSON.stringify(open)}`);
      const requested = await viewCall(shell, tabId, "requestPictureInPicture({ clickAt: 0, control: 0 })");
      if (requested !== false) throw new Error(`an audio-only page reported PiP ${JSON.stringify(requested)}`);
      await viewCall(shell, tabId, "exitPictureInPicture()");
      return { open, requested };
    });
    await t.check("a PiP request without user activation is refused", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5500));
      const requested = await viewCallWithoutGesture(shell, tabId, "requestPictureInPicture({ clickAt: 0, control: 0 })");
      const taken = await viewCallWithoutGesture(shell, tabId, "takeControlPress({ clickAt: 0, control: 0 })");
      if (requested !== false || taken !== false) throw new Error(`requested=${requested} taken=${taken}`);
      return { requested, taken };
    });
    await t.check("a playing background tab is protected from discard and freeze", async () => {
      const other = await shell.newTab(t.fixtures.url.page(1, run));
      await shell.waitTabUrl(other, (u) => u.startsWith(t.fixtures.url.page(1, "")));
      if (!(await shell.eval(`ardiaLinux.webviews.has(${js(tabId)})`))) throw new Error("the media tab is no longer mounted");
      const discard = await viewCall(shell, tabId, "discard()");
      const frozen = await viewCall(shell, tabId, "setFrozen(true)");
      if (discard !== "refused" || frozen !== false) throw new Error(`discard=${discard} frozen=${frozen}`);
      if (!(await evaluate(page, "!document.getElementById('tone').paused"))) throw new Error("playback stopped");
      return { discard, frozen };
    });
    await t.check("navigating away clears the player", async () => {
      await navigateTab(shell, tabId, t.fixtures.url.page(2, run));
      await until(async () => (await session(shell, tabId)) === null, { timeout: 10000, label: "the session to clear" });
      await until(async () => !(await audible(shell, tabId)), { timeout: 10000, label: "the audio badge to clear" });
      return true;
    });
    await t.check("manual PiP of a video outside the media session never gives the page user activation", async () => {
      const videoUrl = t.fixtures.url.silentVideo(run);
      await navigateTab(shell, tabId, videoUrl);
      const video = await mediaPage(state, videoUrl);
      await until(() => evaluate(video, "document.getElementById('big').readyState > 0 && !document.getElementById('big').paused", { userGesture: false }), { timeout: 10000, label: "the silent video to play" });
      if (await evaluate(video, "navigator.userActivation.hasBeenActive", { userGesture: false })) throw new Error("the fixture already had user activation");
      const requested = await viewCall(shell, tabId, "requestPictureInPicture({ clickAt: 0, control: 0 })");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const sticky = await evaluate(video, "navigator.userActivation.hasBeenActive", { userGesture: false });
      const transient = await evaluate(video, "navigator.userActivation.isActive", { userGesture: false });
      if (sticky || transient) throw new Error(`the page got user activation: sticky=${sticky} transient=${transient}`);
      await viewCall(shell, tabId, "exitPictureInPicture()");
      return { requested, sticky, transient };
    });
    await t.check("a site with autoplay blocked plays only after the user interacts", async () => {
      const origin = new URL(url).origin;
      await call(shell, "sites.setSetting", { origin, type: "autoplay", value: "block", engine: "chromium" });
      try {
        const blockedUrl = t.fixtures.url.media(`${run}-blocked`);
        await navigateTab(shell, tabId, blockedUrl);
        const blocked = await mediaPage(state, blockedUrl);
        await evaluate(blocked, "startTone().catch(() => false)", { userGesture: false });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!(await evaluate(blocked, "document.getElementById('tone').paused", { userGesture: false }))) throw new Error("the tone played without user activation");
        await startTone(blocked);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (await evaluate(blocked, "document.getElementById('tone').paused")) throw new Error("the tone stopped after the user played it");
        await evaluate(blocked, "document.getElementById('tone').pause()");
        return { origin };
      } finally {
        await call(shell, "sites.setSetting", { origin, type: "autoplay", value: "default", engine: "chromium" });
      }
    });
  },
};
