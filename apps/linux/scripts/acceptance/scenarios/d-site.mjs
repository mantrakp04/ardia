import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { ardiaWindow, choosePanelPermission, closeSiteControls, clickInPage, clickMenuItem, expandSiteControls, focusPageByClick, openSettingsRow, openSiteControls, pageFixtures, pageSession, probe, rowControl, scrolledIntoView, shot, sitePermissionValue, titledSeed , closeSettingsWindow } from "../lib/desktopPages.mjs";
import { clickTextIn, desktopUnavailable, openDesktop, pointAt, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { changedCells, regions } from "../lib/desktop.mjs";
import { js, until } from "../lib/util.mjs";

const FAKE_DEVICES = ["--use-fake-device-for-media-stream"];
const permissionState = (app, url, name) => probe(app, url, `navigator.permissions.query({ name: ${js(name)} }).then((s) => s.state)`);

async function reloadByKey(desktop, window, shell, app, url, tabId) {
  await focusPageByClick(desktop, window, shell, app, url, tabId);
  await probe(app, url, "window.beforeReload = true");
  await desktop.key("ctrl+r");
  await until(async () => (await probe(app, url, "window.beforeReload === undefined && document.readyState === 'complete'").catch(() => false)), { timeout: 10000, label: "Ctrl+R to reload the page" });
}

async function openSiteSheet(desktop, app, shell, host) {
  const { settings, window } = await openSettingsRow(desktop, app, shell, "Privacy & Security", host);
  const row = await scrolledIntoView(desktop, window, settings, () => settings.rectByText(host), { label: `the ${host} row` });
  await pointAt(desktop, window, row);
  await settings.waitFor("document.body.innerText.includes('Reset Permissions')", { timeout: 8000, label: `the ${host} sheet` });
  await delay(600);
  const value = async (title) => (await rowControl(settings, title, { minWidth: 40, maxWidth: 260, nearest: true }))?.text ?? null;
  return { settings, window, value };
}

async function closeSettings(desktop, settings, window) {
  await clickTextIn(desktop, window, settings, "Done").catch(() => {});
  await delay(400);
  await closeSettingsWindow(desktop, window, settings);
  await delay(800);
}

export const BUBBLE_BUTTONS = { "Allow while visiting the site": 131, "Allow this time": 85, "Never allow": 39 };

export function bubbleRegion(before, after) {
  const found = regions(changedCells(before, after, { cell: 4, fill: 0.2 }), { gap: 2 });
  return found.find((r) => r.width >= 250 && r.width <= 420 && r.height >= 250 && r.height <= 800) ?? null;
}

async function requestAndAnswer(t, desktop, window, shell, page, tabId, answer) {
  const before = await desktop.capture();
  await clickInPage(desktop, window, shell, page, tabId, "document.getElementById('camera')");
  let bubble = null;
  await until(async () => { bubble = bubbleRegion(before, await desktop.capture()); return bubble; }, { timeout: 10000, label: "Chrome's camera permission bubble on screen" });
  await delay(600);
  bubble = bubbleRegion(before, await desktop.capture()) ?? bubble;
  await shot(t, desktop, `permission-bubble-${answer.split(" ")[0].toLowerCase()}`);
  await desktop.pointerMove(bubble.x + bubble.width / 2, bubble.y + bubble.height - BUBBLE_BUTTONS[answer] - 20);
  await delay(200);
  await desktop.click(bubble.x + bubble.width / 2, bubble.y + bubble.height - BUBBLE_BUTTONS[answer]);
  return bubble;
}

export const f06Desktop = {
  id: "F06D",
  issue: 16,
  desktop: true,
  title: "Site Controls and Settings › Privacy & Security drive the same permissions, and the camera prompt answered with the pointer, with fake media devices in a private sway session",
  deadline: 480000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Site panel and Privacy settings drive the same state", ["Change Camera in Site Controls and Location in Settings › Privacy & Security: each shows the other's change and the page agrees after reload; the panel's blocker toggle lists the site under Sites without blocking."], missing);
      t.manual("Native permission prompts", ["Allow a page's camera and microphone request: Site settings shows it and it survives restart; Block likewise."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const pages = await pageFixtures(t);
    const permissionsUrl = t.fixtures.url.permissions();
    const host = new URL(permissionsUrl).host;
    const allowUrl = pages.https("media-requests", "", "mixed.ardia.test");
    const blockUrl = pages.https("media-requests", "?deny=1", "suggestqueries.google.com");
    const seed = titledSeed(sessionSeed({ windows: [{ id: "main", urls: [blockUrl, allowUrl, permissionsUrl] }] }), { [permissionsUrl]: "Permissions fixture", [allowUrl]: "Media requests", [blockUrl]: "Media requests (deny)" });
    let state = await startDesktopBrowser(t, desktop, { name: "site-controls", session: seed, extraArgs: FAKE_DEVICES });
    let { app, shell } = state;
    let window = await ardiaWindow(desktop);
    const tabOf = (url) => shell.waitState(`return Object.values(s.tabs).find((x) => x.url === ${js(url)})?.id ?? false;`, { label: `the tab on ${url}` });
    const permissionsTab = await tabOf(permissionsUrl);

    await t.check("Camera set to Blocked in Site Controls shows as Block in Settings › Privacy & Security and the page sees denied after Ctrl+R", async () => {
      const chosen = await choosePanelPermission(desktop, window, shell, "Camera", "Blocked");
      await shot(t, desktop, "panel-camera-blocked");
      await closeSiteControls(desktop, window, shell);
      const sheet = await openSiteSheet(desktop, app, shell, host);
      const shown = await sheet.value("Camera");
      await shot(t, desktop, "settings-camera-block");
      await closeSettings(desktop, sheet.settings, sheet.window);
      if (shown !== "Block") throw new Error(`Settings shows Camera as ${shown}`);
      await reloadByKey(desktop, window, shell, app, permissionsUrl, permissionsTab);
      const page = await permissionState(app, permissionsUrl, "camera");
      if (page !== "denied") throw new Error(`the page reads camera ${page}`);
      return { panel: chosen.value, settings: shown, page };
    });

    await t.check("Location set to Allow in Settings › Privacy & Security shows as Allowed when Site Controls is reopened and the page sees granted after Ctrl+R", async () => {
      const sheet = await openSiteSheet(desktop, app, shell, host);
      const control = await rowControl(sheet.settings, "Location", { minWidth: 40, maxWidth: 260, nearest: true });
      await pointAt(desktop, sheet.window, control);
      await delay(700);
      await clickMenuItem(desktop, sheet.window, sheet.settings, "Allow");
      await until(async () => (await sheet.value("Location")) === "Allow", { timeout: 5000, label: "the sheet to show Allow" });
      await closeSettings(desktop, sheet.settings, sheet.window);
      await closeSiteControls(desktop, window, shell);
      await expandSiteControls(desktop, window, shell);
      const panel = await until(async () => { const v = await sitePermissionValue(shell, "Location"); return v?.value === "Allowed" ? v : false; }, { timeout: 5000, label: "Site Controls to show Location Allowed" });
      await shot(t, desktop, "panel-location-allowed");
      await closeSiteControls(desktop, window, shell);
      await reloadByKey(desktop, window, shell, app, permissionsUrl, permissionsTab);
      const page = await permissionState(app, permissionsUrl, "geolocation");
      if (page !== "granted") throw new Error(`the page reads geolocation ${page}`);
      return { panel: panel.value, page };
    });

    await t.check("turning Block Ads & Trackers off in Site Controls lists the site under Sites without blocking in Settings", async () => {
      await openSiteControls(desktop, window, shell);
      await clickTextIn(desktop, window, shell, "Block Ads & Trackers");
      await until(async () => (await shell.text()).includes("Off for this site"), { timeout: 8000, label: "the panel to show Off for this site" });
      await shot(t, desktop, "blocker-off");
      await closeSiteControls(desktop, window, shell);
      const { settings, window: settingsWindow } = await openSettingsRow(desktop, app, shell, "Privacy & Security", "Sites without blocking");
      const listed = await until(async () => { const text = await settings.text(); const at = text.indexOf("Sites without blocking"); return at >= 0 && text.slice(at).includes(new URL(permissionsUrl).hostname) ? text.slice(at, at + 200) : false; }, { timeout: 8000, label: "the host under Sites without blocking" });
      await shot(t, desktop, "sites-without-blocking");
      await closeSettings(desktop, settings, settingsWindow);
      return { listed };
    });

    await t.check("a camera and microphone request answered Allow while visiting the site gets the fake devices and shows Allow in Settings", async () => {
      await clickTextIn(desktop, window, shell, "Media requests").catch(() => {});
      const tabId = await tabOf(allowUrl);
      await shell.state(`s.activate(${js(tabId)}); return true;`);
      const page = await pageSession(app, allowUrl);
      await focusPageByClick(desktop, window, shell, app, allowUrl, tabId);
      const bubble = await requestAndAnswer(t, desktop, window, shell, page, tabId, "Allow while visiting the site");
      const log = await until(async () => { const l = await evaluate(page, "mediaLog", { userGesture: false }); return l.length ? l : false; }, { timeout: 10000, label: "the page's getUserMedia result" });
      if (log[0] !== "granted:audio+video") throw new Error(`the page got ${JSON.stringify(log)}`);
      const sheet = await openSiteSheet(desktop, app, shell, new URL(allowUrl).host);
      const shown = { camera: await sheet.value("Camera"), microphone: await sheet.value("Microphone") };
      await shot(t, desktop, "settings-allowed");
      await closeSettings(desktop, sheet.settings, sheet.window);
      if (shown.camera !== "Allow" || shown.microphone !== "Allow") throw new Error(`Settings shows ${JSON.stringify(shown)}`);
      return { bubble, log, shown };
    });

    await t.check("a request answered Never allow is refused and shows Block in Settings", async () => {
      const tabId = await tabOf(blockUrl);
      await shell.state(`s.activate(${js(tabId)}); return true;`);
      const page = await pageSession(app, blockUrl);
      await focusPageByClick(desktop, window, shell, app, blockUrl, tabId);
      await requestAndAnswer(t, desktop, window, shell, page, tabId, "Never allow");
      const log = await until(async () => { const l = await evaluate(page, "mediaLog", { userGesture: false }); return l.length ? l : false; }, { timeout: 10000, label: "the page's getUserMedia result" });
      if (!log[0].startsWith("denied:")) throw new Error(`the page got ${JSON.stringify(log)}`);
      const sheet = await openSiteSheet(desktop, app, shell, new URL(blockUrl).host);
      const shown = { camera: await sheet.value("Camera"), microphone: await sheet.value("Microphone") };
      await closeSettings(desktop, sheet.settings, sheet.window);
      if (shown.camera !== "Block" || shown.microphone !== "Block") throw new Error(`Settings shows ${JSON.stringify(shown)}`);
      return { log, shown };
    });

    await t.check("after a restart the allowed site gets its devices and the blocked one is refused, both without a prompt", async () => {
      await t.stop(app);
      state = await startDesktopBrowser(t, desktop, { scratch: state.scratch, label: "restart", extraArgs: FAKE_DEVICES });
      ({ app, shell } = state);
      window = await ardiaWindow(desktop);
      const results = {};
      for (const [url, want] of [[allowUrl, "granted:audio+video"], [blockUrl, "denied:NotAllowedError"]]) {
        const tabId = await shell.waitState(`return Object.values(s.tabs).find((x) => x.url === ${js(url)})?.id ?? false;`, { label: `the restored tab on ${url}` });
        await shell.state(`s.activate(${js(tabId)}); return true;`);
        const page = await pageSession(app, url);
        await focusPageByClick(desktop, window, shell, app, url, tabId);
        const before = await desktop.capture();
        let log = null;
        for (let attempt = 0; attempt < 2 && !log; attempt++) {
          await clickInPage(desktop, window, shell, page, tabId, "document.getElementById('camera')");
          log = await until(async () => { const l = await evaluate(page, "mediaLog", { userGesture: false }); return l.length ? l : false; }, { timeout: 5000, label: "the page's getUserMedia result" }).catch(() => null);
        }
        if (!log) {
          const bubble = bubbleRegion(before, await desktop.capture());
          await shot(t, desktop, `restart-${new URL(url).hostname}`);
          throw new Error(`${new URL(url).hostname} gave the page no answer after restart; ${bubble ? `a permission bubble is on screen at ${JSON.stringify(bubble)}` : "no bubble on screen"}`);
        }
        if (log[0] !== want) throw new Error(`${url} got ${JSON.stringify(log)} after restart`);
        results[new URL(url).hostname] = log[0];
      }
      return results;
    });
    await t.stop(app);
  },
};
