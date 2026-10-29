import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { AUDIO_TOOLS, startAudio } from "../lib/desktopAudio.mjs";
import { ardiaWindow, clickBlankPage, clickInPage, clickMenuItem, menuItems, paneRect, clickRowToggle, clickSidebarTab, focusPageByClick, hasFfmpeg, labelled, missingCommands, openSettingsRow, openSiteControls, pageFixtures, pageSession, screenPoint, shot, titledSeed , closeSettingsWindow } from "../lib/desktopPages.mjs";
import { colorDistance, meanColor, toHex } from "../lib/desktopPixels.mjs";
import { clickLabelIn, clickTextIn, currentRect, desktopUnavailable, newWindow, openDesktop, pointAt, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { playByClickWith, videoPlaying, videoStateScript } from "../lib/desktopMedia.mjs";
import { nonce } from "../lib/util.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, until } from "../lib/util.mjs";

const PIP_TITLE = "Picture in picture";
const pipWindows = async (desktop) => (await desktop.windows()).filter((w) => w.title === PIP_TITLE);
const pipOpen = (shell) => shell.eval("JSON.stringify(ardiaLinux.media.getState().pipOpen)").then(JSON.parse);
const videoState = (session, id = "video") => evaluate(session, videoStateScript(id), { userGesture: false });
const playing = async (session, id = "video") => videoPlaying(await videoState(session, id));

async function waitPip(desktop, { timeout = 10000 } = {}) {
  return until(async () => (await pipWindows(desktop))[0] ?? false, { timeout, label: "a Picture in picture window in the compositor" });
}

async function waitNoPip(desktop, { timeout = 10000 } = {}) {
  return until(async () => (await pipWindows(desktop)).length === 0, { timeout, label: "the Picture in picture window to close" });
}

async function playByClick(desktop, window, shell, session, tabId, id = "video") {
  let before = null;
  let clicked = null;
  return playByClickWith({
    read: async () => (before = await videoState(session, id)),
    click: async () => { clicked = await clickInPage(desktop, window, shell, session, tabId, `document.getElementById(${js(id)})`); },
    wait: () => until(() => playing(session, id), { timeout: 10000, label: `the ${id} element to play${clicked ? " after a click" : ""}` }).catch(async (error) => {
      throw new Error(`${error.message}; before ${JSON.stringify(before)}, clicked at ${JSON.stringify(clicked)}, now ${JSON.stringify(await videoState(session, id).catch(() => null))}`);
    }),
  });
}

async function tabIdFor(shell, url) {
  return shell.waitState(`return Object.values(s.tabs).find((x) => x.url === ${js(url)})?.id ?? false;`, { label: `the tab on ${url}` });
}

const clickTab = clickSidebarTab;

async function settingsToggle(desktop, app, shell, title) {
  const { settings, window } = await openSettingsRow(desktop, app, shell, "Tabs", title);
  await clickRowToggle(desktop, window, settings, title);
  await delay(800);
  await closeSettingsWindow(desktop, window, settings);
  await delay(800);
  return window;
}

export const f15Desktop = {
  id: "F15D",
  issue: 25,
  desktop: true,
  title: "Picture in Picture windows, automatic PiP and mute heard through a null sink, driven with the pointer in a private sway session",
  deadline: 480000,
  async run(t) {
    const missing = (await desktopUnavailable()) ?? ((await hasFfmpeg()) ? null : "ffmpeg with libvpx and libopus not found; it makes the video fixtures");
    const steps = {
      manual: ["Play a video page and use the Picture in Picture control in Site Controls: a PiP window opens; pressing it again closes it and returns to the tab."],
      outside: ["Open a page with muted, looping videos outside the media session: the tab's Picture in Picture control opens the largest playing video, skips disablepictureinpicture, and the page gets no user activation."],
      auto: ["With Settings › Tabs › Automatic Picture in Picture on, switch away from a playing video tab: a PiP window opens and closes when you return; with it off nothing opens."],
      mute: ["Mute a playing tab from its audio badge: the sound stops; unmuting restores it."],
      capture: ["Share a screen through the portal picker: the tab shows the sharing indicator while capturing and it clears when sharing stops."],
    };
    if (missing) {
      t.manual("Manual PiP of a real video", steps.manual, missing);
      t.manual("Manual PiP of a video outside the media session", steps.outside, missing);
      t.manual("Automatic PiP still separate", steps.auto, missing);
      t.manual("Hear mute", steps.mute, missing);
      t.manual("Portal capture indicators", steps.capture, missing);
      return;
    }
    const desktop = await openDesktop(t);
    const audioMissing = await missingCommands(desktop, AUDIO_TOOLS);
    const audio = audioMissing.length ? null : await startAudio(desktop).catch((error) => ({ error: error.message }));
    const pages = await pageFixtures(t, { clips: true });
    const videoUrl = pages.https("video", "?register=1");
    const otherUrl = t.fixtures.url.page(2, "f15d");
    const outsideUrl = pages.http("outside-session");
    const { app, shell } = await startDesktopBrowser(t, desktop, {
      name: "media",
      session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [outsideUrl, otherUrl, videoUrl] }], settings: { autoPictureInPicture: true } }), { [outsideUrl]: "Videos outside the media session", [otherUrl]: "Acceptance page 2", [videoUrl]: "Desktop video" }),
      env: audio && !audio.error ? audio.env : {},
    });
    const window = await ardiaWindow(desktop);
    const videoTab = await tabIdFor(shell, videoUrl);
    const otherTab = await tabIdFor(shell, otherUrl);
    const video = await pageSession(app, videoUrl);
    await t.check("a click on the video starts playback with sound in the media session", async () => {
      await playByClick(desktop, window, shell, video, videoTab);
      const session = await until(async () => {
        const s = await shell.eval(`ardiaLinux.media.getState().sessions[${js(videoTab)}] ?? null`);
        return s?.hasVideo && s.playbackState === "playing" ? s : false;
      }, { timeout: 10000, label: "a playing media session with video" });
      return { hasVideo: session.hasVideo, actions: session.actions };
    }, { critical: true });

    await t.check("Site Controls › Picture in Picture opens a compositor PiP window and pressing it again closes it and keeps the tab", async () => {
      await openSiteControls(desktop, window, shell);
      const known = await desktop.windows();
      await clickLabelIn(desktop, window, shell, "Picture in Picture");
      const pip = await newWindow(desktop, known, { label: "the PiP window" });
      if (pip.title !== PIP_TITLE) throw new Error(`a window titled ${pip.title} opened instead of the PiP window`);
      const open = await until(async () => (await pipOpen(shell))[videoTab] ?? false, { timeout: 5000, label: "the control's open state" });
      await shot(t, desktop, "pip-open");
      await clickInPage(desktop, window, shell, video, videoTab, "document.querySelector('h1')");
      await openSiteControls(desktop, window, shell);
      if (!(await labelled(shell, "Exit Picture in Picture"))) throw new Error(`the control doesn't show the open state: ${JSON.stringify((await shell.labels()).filter((l) => /Picture/.test(l)))}`);
      await clickLabelIn(desktop, window, shell, "Exit Picture in Picture");
      await waitNoPip(desktop);
      const after = await pipOpen(shell);
      if (after[videoTab]) throw new Error(`pipOpen still lists the tab: ${JSON.stringify(after)}`);
      if ((await shell.activeTabId()) !== videoTab) throw new Error("closing PiP left a different tab active");
      if (!(await playing(video))) throw new Error("playback stopped when PiP closed");
      return { pip: { title: pip.title, rect: pip.rect }, open };
    });

    await t.check("the tab's Mute Site badge silences the null sink and Unmute Site brings the tone back", async () => {
      if (!audio) throw new Error(`no audio session: ${audioMissing.join(", ")} not found`);
      if (audio.error) throw new Error(`the private PipeWire session didn't start: ${audio.error}`);
      await playByClick(desktop, window, shell, video, videoTab);
      const loud = await audio.level();
      if (loud < 300) throw new Error(`the playing tone measures RMS ${loud} on the null sink`);
      await clickLabelIn(desktop, window, shell, "Mute Site");
      await until(() => labelled(shell, "Unmute Site"), { timeout: 5000, label: "the badge to show muted" });
      await delay(500);
      const muted = await audio.level();
      await shot(t, desktop, "muted");
      if (muted > 30) throw new Error(`muted tab still measures RMS ${muted}`);
      if (!(await playing(video))) throw new Error("muting paused the video");
      await clickLabelIn(desktop, window, shell, "Unmute Site");
      await until(() => labelled(shell, "Mute Site"), { timeout: 5000, label: "the badge to show unmuted" });
      await delay(500);
      const back = await audio.level();
      if (back < 300) throw new Error(`after unmuting the tone measures RMS ${back}`);
      return { loud, muted, back };
    });

    await t.check("with Automatic Picture in Picture on, leaving a playing video tab opens a PiP window and coming back closes it", async () => {
      await playByClick(desktop, window, shell, video, videoTab);
      await delay(1500);
      await clickTab(desktop, window, shell, "Acceptance page 2");
      await until(async () => (await shell.activeTabId()) === otherTab, { timeout: 5000, label: "Acceptance page 2 to be the active tab" });
      const pip = await waitPip(desktop).catch(async (error) => { throw new Error(`${error.message}; page log ${JSON.stringify(await evaluate(video, "pipLog", { userGesture: false }))}`); });
      await shot(t, desktop, "auto-pip");
      await clickTab(desktop, window, shell, "Desktop video");
      await waitNoPip(desktop);
      return { pip: pip.rect, log: await evaluate(video, "pipLog", { userGesture: false }) };
    });

    await t.check("with Automatic Picture in Picture turned off in Settings › Tabs, leaving the tab opens nothing", async () => {
      await settingsToggle(desktop, app, shell, "Automatic Picture in Picture");
      const setting = await until(async () => (await shell.state("return s.settings.autoPictureInPicture")) === false, { timeout: 5000, label: "the setting to turn off" });
      await clickTab(desktop, window, shell, "Desktop video");
      await playByClick(desktop, window, shell, video, videoTab);
      await delay(1500);
      await clickTab(desktop, window, shell, "Acceptance page 2");
      await until(async () => (await shell.activeTabId()) === otherTab, { timeout: 5000, label: "Acceptance page 2 to be the active tab" });
      await delay(5000);
      const opened = await pipWindows(desktop);
      if (opened.length) throw new Error(`a PiP window opened with the setting off: ${JSON.stringify(opened.map((w) => w.rect))}`);
      await clickTab(desktop, window, shell, "Desktop video");
      return { setting };
    });

    await t.check("a playing muted video outside the media session gets a Picture in Picture control that opens the largest eligible video without activating the page", async () => {
      await clickTab(desktop, window, shell, "Videos outside the media session");
      const outsideTab = await tabIdFor(shell, outsideUrl);
      const outside = await pageSession(app, outsideUrl);
      await until(() => playing(outside, "big"), { timeout: 10000, label: "the muted videos to play" });
      if (await evaluate(outside, "navigator.userActivation.hasBeenActive", { userGesture: false })) throw new Error("the page already had user activation");
      await openSiteControls(desktop, window, shell);
      const panel = (await shell.labels()).filter((l) => /Picture|PiP|Cast/.test(l));
      await shot(t, desktop, "outside-session-controls");
      if (!panel.includes("Picture in Picture")) {
        await desktop.key("escape");
        throw new Error(`Site Controls offers ${JSON.stringify(panel)} and no Picture in Picture for a playing video outside the media session; media sessions ${await shell.eval(`JSON.stringify(ardiaLinux.media.getState().sessions[${js(outsideTab)}] ?? null)`)}`);
      }
      const known = await desktop.windows();
      await clickLabelIn(desktop, window, shell, "Picture in Picture");
      await newWindow(desktop, known, { label: "the PiP window" });
      const element = await evaluate(outside, "document.pictureInPictureElement?.id ?? null", { userGesture: false });
      await delay(6500);
      const activation = await evaluate(outside, "({ sticky: navigator.userActivation.hasBeenActive, popup: popupResult })", { userGesture: false });
      if (element !== "big") throw new Error(`PiP shows ${element}, not the largest eligible video`);
      if (activation.sticky || activation.popup) throw new Error(`the page got activation: ${JSON.stringify(activation)}`);
      return { element, activation };
    });

    t.manual("Portal capture indicators", steps.capture, "the private portal has no ScreenCast backend with a PipeWire video source yet");
    await t.stop(app);
  },
};

export const privateAutoPipDesktop = {
  id: "F02-173D",
  issue: 173,
  desktop: true,
  title: "Automatic PiP stays off in a private window and works in a regular one, driven with real keys and the pointer in a private sway session",
  deadline: 300000,
  async run(t) {
    const missing = (await desktopUnavailable()) ?? ((await hasFfmpeg()) ? null : "ffmpeg with libvpx and libopus not found; it makes the video fixtures");
    if (missing) {
      t.manual("Automatic PiP stays off in a private window", ["With automatic PiP on, a registered video in a private window doesn't enter PiP on a tab switch; in a regular window it does."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t, { clips: true });
    const videoUrl = pages.https("video", "?register=1");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "private-auto-pip", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1, "f02-173d")] }] , settings: { autoPictureInPicture: true } }) });
    const regular = await ardiaWindow(desktop);

    async function playThenLeave(window, windowShell, label) {
      const frame = await currentRect(desktop, window);
      await desktop.click(frame.x + frame.width * 0.6, frame.y + frame.height * 0.6);
      await until(async () => (await desktop.focused())?.id === window.id, { timeout: 5000, label: `${label}: compositor focus after a click` }).catch(async (error) => {
        await shot(t, desktop, `${label.replace(/ /g, "-")}-focus`);
        throw new Error(`${error.message}; clicked ${JSON.stringify(frame)}, windows ${JSON.stringify((await desktop.windows()).map((w) => ({ id: w.id, title: w.title, focused: w.focused, rect: w.rect })))}, wanted ${window.id}`);
      });
      await delay(300);
      await desktop.key("ctrl+l");
      await delay(500);
      await desktop.type(videoUrl);
      await desktop.key("Return");
      const tabId = await until(async () => windowShell.state(`const w = s.windows[windowId]; return Object.values(s.tabs).find((x) => x.windowId === windowId && x.url === ${js(videoUrl)})?.id ?? false;`), { timeout: 15000, label: `${label}: the typed URL to load` });
      const target = await app.pageTarget((x) => x.url === videoUrl && !seen.has(x.id), { timeout: 15000, label: `${label}: the video page target` });
      seen.add(target.id);
      const session = await app.connect(target);
      await until(() => evaluate(session, "document.readyState === 'complete'", { userGesture: false }), { timeout: 10000, label: `${label}: the video page to load` });
      await playByClick(desktop, window, windowShell, session, tabId);
      await delay(1500);
      await desktop.key("ctrl+t");
      const left = await until(async () => { const active = await windowShell.activeTabId(); return active && active !== tabId ? active : false; }, { timeout: 5000, label: `${label}: Ctrl+T to leave the video tab` });
      const visibility = await until(async () => { const v = await evaluate(session, "document.visibilityState", { userGesture: false }); return v === "hidden" ? v : false; }, { timeout: 4000, label: "the video page to be hidden" }).catch(async () => evaluate(session, "document.visibilityState", { userGesture: false }));
      if (visibility !== "hidden") {
        await shot(t, desktop, `${label.replace(/ /g, "-")}-after-ctrl-t`);
        throw new Error(`${label}: Ctrl+T made ${left} the active tab, but the video page still reports visibilityState ${visibility}`);
      }
      return { tabId, session, left };
    }
    const seen = new Set();

    await t.check("in a private window opened with Ctrl+Shift+N, leaving a playing registered video opens no PiP window", async () => {
      const frame = await currentRect(desktop, regular);
      await desktop.click(frame.x + frame.width * 0.6, frame.y + frame.height * 0.6);
      await delay(300);
      const known = await desktop.windows();
      await desktop.key("ctrl+shift+n");
      const window = await newWindow(desktop, known, { label: "the private window" });
      const privateShell = await until(async () => {
        const found = (await app.shells()).find((s) => s.privateWindow && s.ready);
        return found ? app.shell(found.windowId) : false;
      }, { timeout: 15000, label: "the private window's shell" });
      await delay(1000);
      const row = await until(() => privateShell.rectByText("New Tab"), { timeout: 8000, label: "the private window's sidebar" });
      const privateFrame = await currentRect(desktop, window);
      await desktop.click(privateFrame.x + row.x, privateFrame.y + row.y);
      await until(async () => (await desktop.focused())?.id === window.id, { timeout: 5000, label: "the private window to take focus from a sidebar click" });
      const { session } = await playThenLeave(window, privateShell, "private window");
      await delay(6000);
      const opened = await pipWindows(desktop);
      await shot(t, desktop, "private-left");
      const log = await evaluate(session, "pipLog", { userGesture: false });
      if (opened.length || log.includes("opened")) throw new Error(`a private window entered PiP: windows ${opened.length}, page log ${JSON.stringify(log)}`);
      return { log, title: window.title };
    });

    await t.check("the same page in a regular window enters PiP when you leave it", async () => {
      const window = regular;
      const { session } = await playThenLeave(window, shell, "regular window");
      const pip = await waitPip(desktop).catch(async (error) => { throw new Error(`${error.message}; page log ${JSON.stringify(await evaluate(session, "pipLog", { userGesture: false }))}`); });
      return { pip: pip.rect, log: await evaluate(session, "pipLog", { userGesture: false }) };
    });
    await t.stop(app);
  },
};

const chromeColor = async (desktop, window) => {
  const frame = await currentRect(desktop, window);
  const image = await desktop.capture();
  return { sidebar: meanColor(image, { x: frame.x + 12, y: frame.y + 420, width: 150, height: 400 }), frame };
};
async function dismissPopupPrompt(desktop, window, shell, tabId) {
  for (let attempt = 0; attempt < 4 && (await shell.text()).includes("Always allow pop-ups from"); attempt++) {
    if (attempt === 0) await clickBlankPage(desktop, window, shell, tabId);
    else if (attempt === 1) await desktop.key("escape");
    else {
      const pane = await paneRect(shell, tabId);
      const icon = await shell.eval(`(() => { const r = [...document.querySelectorAll('[aria-label],[title]')].filter((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title') ?? '').startsWith('Pop-ups blocked')).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < 60 && r.left >= ${pane?.left ?? 0} - 2 && r.left <= ${(pane?.left ?? 0) + (pane?.width ?? 0)}).sort((a, b) => a.width - b.width)[0]; return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
      if (icon) await pointAt(desktop, window, icon);
    }
    await delay(700);
  }
  if ((await shell.text()).includes("Always allow pop-ups from")) {
    await desktop.screenshot?.(`${desktop.dir}/popup-prompt-${Date.now()}.png`).catch(() => {});
    throw new Error("the blocked pop-ups prompt didn't dismiss with a click on the page or Escape");
  }
}

const pageStateOf = (shell, tabId) => shell.eval(`(ardiaLinux.pages?.getState().pages ?? {})[${js(tabId)}] ?? null`);
const swayFullscreen = async (desktop, window) => (await desktop.windows()).find((w) => w.id === window.id)?.fullscreen ?? null;

async function controlsFullscreen(desktop, window, shell, session, tabId) {
  const video = await screenPoint(desktop, window, shell, session, tabId, "document.getElementById('video')");
  const right = video.rect.x + video.rect.width;
  const bottom = video.rect.y + video.rect.height;
  for (const [dx, dy] of [[73, 48], [56, 22]]) {
    await desktop.pointerMove(video.x, video.y);
    await delay(700);
    await desktop.click(right - dx, bottom - dy);
    const entered = await until(async () => (await pageStateOf(shell, tabId))?.fullscreen === true, { timeout: 2500, label: "page fullscreen" }).catch(() => false);
    if (entered) return { offset: [dx, dy] };
    await desktop.key("escape");
    await delay(600);
  }
  throw new Error("none of the player's bottom-right controls entered fullscreen");
}

export const f17Desktop = {
  id: "F17D",
  issue: 27,
  desktop: true,
  title: "Video fullscreen from the player's own button, hover status under the real pointer, and status and pop-ups following a pane moved to another window, in a private sway session",
  deadline: 420000,
  async run(t) {
    const missing = (await desktopUnavailable()) ?? ((await hasFfmpeg()) ? null : "ffmpeg with libvpx and libopus not found; it makes the video fixtures");
    if (missing) {
      t.manual("Video fullscreen from the player's own control", ["Play a video and press its fullscreen button: Ardia's sidebar and toolbar hide; Escape restores them in the same window state."], missing);
      t.manual("Hover status follows the pointer", ["Move the mouse over a link and off it: the status shows the link and clears."], missing);
      t.manual("Split and transfer keep producers on the right pane", ["Open a split, hover a link and trigger a pop-up in each pane, move one pane's tab to another window: its status and pop-ups go with it."], missing);
      return;
    }
    const run = nonce("f17d");
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t, { clips: true });
    const videoUrl = pages.http("video");
    const targetA = t.fixtures.url.page(5, `${run}-a`);
    const targetB = t.fixtures.url.page(5, `${run}-b`);
    const popupA = t.fixtures.url.page(8, `${run}-pa`);
    const popupB = t.fixtures.url.page(8, `${run}-pb`);
    const hoverUrl = pages.http("links", `?title=Hover+page&to=${encodeURIComponent(targetA)}&top=620`);
    const urlA = pages.http("links", `?title=Pane+A&to=${encodeURIComponent(targetA)}&popup=${encodeURIComponent(popupA)}&popupDelay=6000&top=620`);
    const urlB = pages.http("links", `?title=Pane+B&to=${encodeURIComponent(targetB)}&popup=${encodeURIComponent(popupB)}&popupDelay=6000&top=620`);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "page-status", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [hoverUrl, videoUrl] }] }), { [hoverUrl]: "Hover page", [videoUrl]: "Desktop video" }) });
    const window = await ardiaWindow(desktop);
    const videoTab = await tabIdFor(shell, videoUrl);
    const video = await pageSession(app, videoUrl);

    await t.check("the player's own fullscreen button hides Ardia's sidebar and toolbar and Escape restores them in the same window state", async () => {
      await playByClick(desktop, window, shell, video, videoTab);
      const before = await chromeColor(desktop, window);
      const state = { rect: (await currentRect(desktop, window)), fullscreen: await swayFullscreen(desktop, window) };
      const control = await controlsFullscreen(desktop, window, shell, video, videoTab);
      await delay(1200);
      const during = await chromeColor(desktop, window);
      await shot(t, desktop, "video-fullscreen");
      const hidden = colorDistance(before.sidebar, during.sidebar);
      if (hidden < 40) throw new Error(`the sidebar still shows (${toHex(before.sidebar)} → ${toHex(during.sidebar)})`);
      if ((await shell.state("return s.windows[windowId]?.fullScreen ?? null;"))) throw new Error("the window was marked fullscreen");
      await desktop.key("escape");
      await until(async () => (await pageStateOf(shell, videoTab))?.fullscreen === false, { timeout: 5000, label: "Escape to end page fullscreen" });
      await delay(1200);
      const after = await chromeColor(desktop, window);
      const back = colorDistance(before.sidebar, after.sidebar);
      const restored = { rect: await currentRect(desktop, window), fullscreen: await swayFullscreen(desktop, window) };
      if (back > 8) throw new Error(`the sidebar didn't come back (${toHex(before.sidebar)} → ${toHex(after.sidebar)})`);
      if (JSON.stringify(restored) !== JSON.stringify(state)) throw new Error(`the window state changed from ${JSON.stringify(state)} to ${JSON.stringify(restored)}`);
      return { control, hidden, back, state };
    });

    await clickSidebarTab(desktop, window, shell, "Hover page");
    const hoverTab = await tabIdFor(shell, hoverUrl);
    const hoverPage = await pageSession(app, hoverUrl);
    await t.check("moving the real pointer over a link shows its URL in the status and moving off clears it", async () => {
      const link = await screenPoint(desktop, window, shell, hoverPage, hoverTab, "document.getElementById('link')");
      let on = false;
      for (let attempt = 0; attempt < 3 && !on; attempt++) {
        await desktop.pointerMove(link.x + 200, link.y + 600);
        await delay(300);
        await desktop.pointerMove(link.x, link.y);
        on = await until(async () => { const p = await pageStateOf(shell, hoverTab); return p?.status?.includes("/page/5") ? p.status : false; }, { timeout: 2500, label: "the hovered link's status" }).catch(() => false);
      }
      if (!on) throw new Error("moving the pointer onto the link three times set no status");
      const shown = await until(async () => ((await shell.text()).includes("/page/5") ? true : false), { timeout: 3000, label: "the status text on screen" });
      await shot(t, desktop, "hover-status");
      await desktop.pointerMove(link.x + 200, link.y + 700);
      await until(async () => (await pageStateOf(shell, hoverTab))?.status === "", { timeout: 5000, label: "the status to clear" });
      await until(async () => !(await shell.text()).includes("/page/5"), { timeout: 3000, label: "the status text to leave the screen" });
      return { status: on, shown };
    });

    await t.check("a pane moved to a new window takes its status and blocked pop-up with it and the old window shows none", async () => {
      const tabA = await shell.newTab(urlA);
      await shell.waitTabUrl(tabA, (u) => u === urlA);
      const pageA = await pageSession(app, urlA);
      const split = await shell.state(`return s.openSplitPane(windowId, { url: ${js(urlB)}, anchorTabId: ${js(tabA)}, side: "right" });`);
      if (!split?.ok) throw new Error(`openSplitPane failed: ${JSON.stringify(split)}`);
      const tabB = split.tabId;
      const pageB = await pageSession(app, urlB);
      for (const [tabId, page] of [[tabA, pageA], [tabB, pageB]]) {
        const link = await screenPoint(desktop, window, shell, page, tabId, "document.getElementById('link')");
        let hovered = false;
        for (let attempt = 0; attempt < 3 && !hovered; attempt++) {
          await desktop.pointerMove(link.x + 100, link.y + 300);
          await delay(300);
          await desktop.pointerMove(link.x, link.y);
          hovered = await until(async () => (await pageStateOf(shell, tabId))?.status?.includes("/page/5"), { timeout: 2500, label: `hover status in ${tabId}` }).catch(() => false);
        }
        if (!hovered) throw new Error(`no hover status in ${tabId === tabA ? "pane A" : "pane B"}`);
      }
      for (const [tabId, popup] of [[tabA, popupA], [tabB, popupB]]) await until(async () => (await pageStateOf(shell, tabId))?.popups?.some((p) => p.url === popup), { timeout: 10000, label: `the blocked pop-up in ${tabId === tabA ? "pane A" : "pane B"}` });
      await delay(800);
      const beforeMove = await pageStateOf(shell, tabB).then((p) => (p ? { status: p.status, popups: p.popups } : null));
      const frame = await currentRect(desktop, window);
      const half = await until(() => shell.rectByText("Pane B"), { timeout: 8000, label: "pane B's half of the sidebar row" });
      const known = await desktop.windows();
      await desktop.click(frame.x + half.x, frame.y + half.y, "right");
      await delay(800);
      const items = await until(async () => { const list = await menuItems(shell); return list.length ? list : false; }, { timeout: 5000, label: "pane B's tab menu" });
      const path = [];
      for (const step of [items.includes("Move to Window") ? "Move to Window" : items.includes("Move to") ? "Move to" : "Window", "Window", "New Window"]) {
        const now = await menuItems(shell);
        if (!now.includes(step)) continue;
        await clickMenuItem(desktop, window, shell, step);
        path.push(step);
        await delay(500);
        if (step === "New Window") break;
      }
      if (path.at(-1) !== "New Window") throw new Error(`no New Window in pane B's tab menu (went ${JSON.stringify(path)}, menu ${JSON.stringify(await menuItems(shell))})`);
      const moved = await newWindow(desktop, known, { label: "the window pane B moved to" });
      const newShell = await until(async () => {
        for (const s of await app.shells()) {
          if (s.utility || s.windowId === shell.windowId) continue;
          const candidate = await app.shell(s.windowId);
          if (await candidate.state(`return !!s.tabs[${js(tabB)}] && s.tabs[${js(tabB)}].windowId === windowId;`).catch(() => false)) return candidate;
        }
        return false;
      }, { timeout: 15000, label: "the new window's shell holding pane B" });
      const carried = await until(async () => { const p = await pageStateOf(newShell, tabB); return p?.popups?.some((x) => x.url === popupB) ? p : false; }, { timeout: 8000, label: "pane B's pop-up in the new window" }).catch(async (error) => {
        await shot(t, desktop, "moved-pane-missing-popup");
        const strip = (p) => (p ? { status: p.status, popups: p.popups } : null);
        throw new Error(`${error.message}; new window ${JSON.stringify(strip(await pageStateOf(newShell, tabB)))}, old window ${JSON.stringify(strip(await pageStateOf(shell, tabB)))}, pane B's own page state before the move had ${JSON.stringify(beforeMove)}`);
      });
      const page = await pageSession(app, urlB);
      await delay(800);
      await dismissPopupPrompt(desktop, moved, newShell, tabB);
      const link = await screenPoint(desktop, moved, newShell, page, tabB, "document.getElementById('link')");
      await desktop.pointerMove(link.rect.x + Math.min(40, link.rect.width / 2), link.y);
      const status = await until(async () => { const p = await pageStateOf(newShell, tabB); return p?.status?.includes("/page/5") ? p.status : false; }, { timeout: 5000, label: "pane B's hover status in the new window" });
      await shot(t, desktop, "moved-pane");
      const left = await pageStateOf(shell, tabB);
      const oldText = await shell.text();
      if (left?.popups?.length || left?.status) throw new Error(`the old window still has pane B's state: ${JSON.stringify(left)}`);
      if (oldText.includes(popupB)) throw new Error("the old window still lists pane B's pop-up");
      const stayed = await pageStateOf(shell, tabA);
      if (!stayed?.popups?.some((p) => p.url === popupA)) throw new Error("pane A lost its pop-up");
      return { carried: carried.popups.length, status, stayed: stayed.popups.length };
    });
    await t.stop(app);
  },
};

export const w78Desktop = {
  id: "W78D",
  issue: 78,
  desktop: true,
  title: "Page fullscreen inside a window made fullscreen with the window manager's key keeps the window fullscreen, in a private sway session",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Compositor fullscreen keeps page fullscreen separate", ["Make the window fullscreen with the window manager's key, enter and leave page fullscreen: the window stays fullscreen with Ardia's chrome shown again."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    await desktop.command("bindsym Mod4+f fullscreen toggle");
    const pages = await pageFixtures(t);
    const url = pages.http("fullscreen-button");
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "compositor-fullscreen", session: sessionSeed({ windows: [{ id: "main", urls: [url] }] }) });
    const window = await ardiaWindow(desktop);
    const tabId = await shell.activeTabId();
    const page = await pageSession(app, url);
    await t.check("Super+F, then the page's fullscreen button and Escape: the window stays fullscreen and Ardia's chrome comes back", async () => {
      await focusPageByClick(desktop, window, shell, app, url, tabId);
      const before = await chromeColor(desktop, window);
      await desktop.key("super+f");
      await until(() => swayFullscreen(desktop, window), { timeout: 5000, label: "sway to make the window fullscreen" });
      await delay(1200);
      const compositorFullscreen = await chromeColor(desktop, window);
      await shot(t, desktop, "compositor-fullscreen");
      await clickInPage(desktop, window, shell, page, tabId, "document.getElementById('enter')");
      await until(async () => (await pageStateOf(shell, tabId))?.fullscreen === true, { timeout: 5000, label: "page fullscreen" });
      await delay(1200);
      const during = await chromeColor(desktop, window);
      await shot(t, desktop, "page-fullscreen-in-fullscreen-window");
      await desktop.key("escape");
      await until(async () => (await pageStateOf(shell, tabId))?.fullscreen === false, { timeout: 5000, label: "Escape to end page fullscreen" });
      await delay(1200);
      const after = await chromeColor(desktop, window);
      await shot(t, desktop, "after-escape");
      if (colorDistance(compositorFullscreen.sidebar, after.sidebar) > 8) throw new Error(`the chrome after Escape (${toHex(after.sidebar)}) differs from the compositor-fullscreen window before it (${toHex(compositorFullscreen.sidebar)})`);
      const still = await swayFullscreen(desktop, window);
      if (!still) throw new Error("leaving page fullscreen took the window out of compositor fullscreen");
      if (colorDistance(before.sidebar, during.sidebar) < 20) throw new Error(`the sidebar stayed visible in page fullscreen (${toHex(before.sidebar)} → ${toHex(during.sidebar)})`);
      const rect = await currentRect(desktop, window);
      await desktop.key("super+f");
      await until(async () => !(await swayFullscreen(desktop, window)), { timeout: 5000, label: "Super+F to leave fullscreen" });
      return { rect, sidebar: { normal: toHex(before.sidebar), compositorFullscreen: toHex(compositorFullscreen.sidebar), pageFullscreen: toHex(during.sidebar), afterEscape: toHex(after.sidebar) } };
    });
    await t.stop(app);
  },
};
