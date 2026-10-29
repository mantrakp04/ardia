import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { ardiaWindow, clickBlankPage, clickSidebarTab, focusPageByClick, openSiteControls, pageFixtures, paneRect, probe, shot, titledSeed } from "../lib/desktopPages.mjs";
import { differingFraction, fractionNear, parseHex } from "../lib/desktopPixels.mjs";
import { startPortal } from "../lib/desktopServices.mjs";
import { clickLabelIn, currentRect, desktopUnavailable, newWindow, openDesktop, promptAfter, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const DEVTOOLS = (t) => t.url.startsWith("devtools://") || t.url.startsWith("chrome-devtools://");
const GREEN = parseHex("#22aa66");
const findState = (shell, tabId) => shell.state(`return s.find[${js(tabId)}] ?? null;`);

async function frontends(app) {
  return (await app.browserTargets()).filter(DEVTOOLS);
}

async function attachedTo(app, targetId) {
  return (await app.browserTargets()).find((x) => x.targetId === targetId)?.attached ?? false;
}

async function closeAllDevTools(app, shell, tabIds) {
  for (const tabId of tabIds) {
    if (!(await frontends(app)).length) return;
    await shell.state(`s.activate(${js(tabId)}); return true;`);
    await shell.command("toggleDevTools");
    await delay(800);
  }
  await until(async () => (await frontends(app)).length === 0, { timeout: 10000, label: "DevTools to close" });
}

async function frontendSession(app) {
  const frontend = await until(async () => (await frontends(app))[0] ?? false, { timeout: 15000, label: "a DevTools frontend" });
  const target = await until(async () => (await app.targets()).find((x) => x.id === frontend.targetId) ?? false, { timeout: 10000, label: "the frontend's page target" });
  const session = await app.connect(target);
  await until(() => evaluate(session, "document.readyState === 'complete' && !!document.body", { userGesture: false }), { timeout: 15000, label: "the frontend to load" });
  await delay(1500);
  return { frontend, session };
}

export function frontendControl(session, label) {
  return evaluate(session, `(() => { const want = ${js(label)}; let hit = null; const walk = (root) => { for (const n of root.querySelectorAll('*')) { const l = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('title')); if (!hit && l === want) { const r = n.getBoundingClientRect(); if (r.width > 0 && r.height > 0) hit = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } if (n.shadowRoot) walk(n.shadowRoot); } }; walk(document); return hit; })()`, { userGesture: false });
}

async function clickFrontend(desktop, window, shell, tabId, session, label) {
  const at = await until(() => frontendControl(session, label), { timeout: 8000, label: `DevTools control ${label}` });
  const pane = await paneRect(shell, tabId);
  const frame = await currentRect(desktop, window);
  await desktop.click(frame.x + pane.left + at.x, frame.y + pane.top + at.y);
  await delay(900);
}

async function dockTo(desktop, window, shell, tabId, session, side) {
  await clickFrontend(desktop, window, shell, tabId, session, "Customize and control DevTools");
  await clickFrontend(desktop, window, shell, tabId, session, side);
  await delay(800);
}

async function layout(desktop, window, shell, tabId, app, url) {
  const pane = await paneRect(shell, tabId);
  const frame = await currentRect(desktop, window);
  const size = await probe(app, url, "({ width: innerWidth, height: innerHeight })");
  const image = await desktop.capture();
  const box = { x: frame.x + pane.left, y: frame.y + pane.top, width: pane.width, height: pane.height };
  return { pane: box, size, image };
}

function greenWhere(image, rect) {
  return fractionNear(image, { x: rect.x + 4, y: rect.y + 4, width: Math.max(1, rect.width - 8), height: Math.max(1, rect.height - 8) }, GREEN, 30);
}

export function dockVerdict(side, { pane, size }) {
  const problems = [];
  const slack = 4;
  if (side === "bottom") {
    if (Math.abs(size.width - pane.width) > slack) problems.push(`page width ${size.width} differs from the pane's ${pane.width}`);
    if (size.height > pane.height - 100) problems.push(`page height ${size.height} leaves no room for DevTools in ${pane.height}`);
  } else {
    if (Math.abs(size.height - pane.height) > slack) problems.push(`page height ${size.height} differs from the pane's ${pane.height}`);
    if (size.width > pane.width - 100) problems.push(`page width ${size.width} leaves no room for DevTools in ${pane.width}`);
  }
  const page = side === "right" ? { x: pane.x, y: pane.y, width: size.width, height: pane.height }
    : side === "left" ? { x: pane.x + pane.width - size.width, y: pane.y, width: size.width, height: pane.height }
      : { x: pane.x, y: pane.y, width: pane.width, height: size.height };
  const tools = side === "right" ? { x: pane.x + size.width, y: pane.y, width: pane.width - size.width, height: pane.height }
    : side === "left" ? { x: pane.x, y: pane.y, width: pane.width - size.width, height: pane.height }
      : { x: pane.x, y: pane.y + size.height, width: pane.width, height: pane.height - size.height };
  const splitter = side === "right" ? { x: tools.x, y: pane.y + pane.height / 2 } : side === "left" ? { x: page.x, y: pane.y + pane.height / 2 } : { x: pane.x + pane.width / 2, y: tools.y };
  return { problems, page, tools, splitter };
}

async function savedPage(dir, base) {
  const names = await readdir(dir).catch(() => []);
  return names.filter((n) => n.startsWith(base));
}

export const f01Desktop = {
  id: "F01D",
  issue: 11,
  desktop: true,
  title: "Print, Save Page, docked DevTools and page-focus shortcuts on the exact pane, with real keys, the pointer and a private portal in a private sway session",
  deadline: 480000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    const steps = {
      print: ["Focus pane B and choose Print Using System Dialog (Ctrl+Alt+P): the GTK dialog previews pane B and printing to a file writes pane B's text."],
      save: ["Right-click pane B › Save as…, save as Webpage, Complete and as Webpage, Single File: both contain pane B's text and the complete one has its _files folder."],
      docked: ["Open DevTools on pane A, dock it right, bottom and left and drag the splitter each time; the find bar draws over it; closing it returns focus to pane A; Undock opens its own window."],
      keys: ["Click into pane B and press Ctrl+F, Ctrl+Alt+I, Ctrl+Shift+J and Ctrl+Shift+C: each acts on pane B only."],
    };
    if (missing) {
      t.manual("System print dialog prints the correct pane", steps.print, missing);
      t.manual("Save Page writes the focused pane", steps.save, missing);
      t.manual("Docked DevTools layout and focus", steps.docked, missing);
      t.manual("DevTools and Find shortcuts from page focus", steps.keys, missing);
      return;
    }
    const run = nonce("f01d");
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const saves = await t.scratch("saved");
    const urlA = t.fixtures.url.tint("background");
    const pages = await pageFixtures(t);
    const urlB = pages.http("pane", `?label=b-${run}`);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "pages", session: titledSeed(sessionSeed({ windows: [{ id: "main", urls: [urlA] }] }), { [urlA]: "Tint background" }) });
    const window = await ardiaWindow(desktop);
    const tabA = await shell.activeTabId();
    const split = await shell.state(`return s.openSplitPane(windowId, { url: ${js(urlB)}, anchorTabId: ${js(tabA)}, side: "right" });`);
    if (!split?.ok) throw new Error(`openSplitPane failed: ${JSON.stringify(split)}`);
    const tabB = split.tabId;
    const targetA = await app.pageLoaded(urlA);
    const targetB = await app.pageLoaded(urlB);
    const focusB = () => focusPageByClick(desktop, window, shell, app, urlB, tabB);
    const focusA = async () => {
      for (let attempt = 0; attempt < 3 && (await shell.activeTabId()) !== tabA; attempt++) await clickSidebarTab(desktop, window, shell, "Tint background");
      return focusPageByClick(desktop, window, shell, app, urlA, tabA);
    };

    await t.check("clicking into the inactive split pane makes it active and gives its page keyboard focus", async () => {
      await focusB();
      await clickBlankPage(desktop, window, shell, tabA);
      await delay(1000);
      const active = await shell.activeTabId();
      const focused = await probe(app, urlA, "document.hasFocus()");
      await shot(t, desktop, "inactive-pane-click");
      if (active !== tabA || !focused) throw new Error(`after clicking pane A the active tab is ${active === tabA ? "A" : "B"} and pane A's page ${focused ? "has" : "lacks"} focus (#259)`);
      return { active, focused };
    });

    await t.check("Ctrl+F typed in pane B's page opens pane B's find bar only and finds its 5 matches", async () => {
      await focusB();
      await desktop.key("ctrl+f");
      await until(async () => (await findState(shell, tabB))?.open, { timeout: 5000, label: "pane B's find bar" });
      const a = await findState(shell, tabA);
      if (a?.open) throw new Error("pane A's find bar opened too");
      await desktop.type("needle");
      const found = await until(async () => { const f = await findState(shell, tabB); return f?.count === 5 ? f : false; }, { timeout: 8000, label: "5 matches in pane B" });
      await shot(t, desktop, "find-pane-b");
      await desktop.key("escape");
      await until(async () => !(await findState(shell, tabB))?.open, { timeout: 5000, label: "Escape to close pane B's find bar" });
      return { count: found.count, paneA: a?.open ?? false };
    });

    for (const [keys, label] of [["ctrl+alt+i", "DevTools"], ["ctrl+shift+j", "the JavaScript console"], ["ctrl+alt+c", "Inspect Element"], ["ctrl+shift+c", "Inspect Element (Chrome's Linux key)"]]) {
      await t.check(`${keys} typed in pane B's page opens ${label} on pane B only`, async () => {
        await focusB();
        await desktop.key(keys);
        await until(() => attachedTo(app, targetB.id), { timeout: 15000, label: `${label} to inspect pane B` });
        if (await attachedTo(app, targetA.id)) throw new Error(`${label} also inspects pane A`);
        const open = (await frontends(app)).map((f) => f.url.split("?")[0]);
        await closeAllDevTools(app, shell, [tabB, tabA]);
        return { frontends: open };
      });
    }

    let frontend = null;
    await t.check("DevTools docks right, bottom and left inside pane A and the splitter drags in each", async () => {
      await focusA();
      await desktop.key("ctrl+shift+i");
      frontend = await frontendSession(app);
      if (!(await attachedTo(app, targetA.id))) throw new Error("DevTools doesn't inspect pane A");
      const seen = {};
      for (const side of ["right", "bottom", "left"]) {
        if (side !== "right") await dockTo(desktop, window, shell, tabA, frontend.session, `Dock to ${side}`);
        else await dockTo(desktop, window, shell, tabA, frontend.session, "Dock to right");
        const before = await layout(desktop, window, shell, tabA, app, urlA);
        const verdict = dockVerdict(side, before);
        if (verdict.problems.length) throw new Error(`${side}: ${verdict.problems.join("; ")}`);
        const pageGreen = greenWhere(before.image, verdict.page);
        const toolsGreen = greenWhere(before.image, verdict.tools);
        await shot(t, desktop, `devtools-${side}`);
        if (pageGreen < 0.6 || toolsGreen > 0.1) throw new Error(`${side}: the page isn't where its size says (green ${pageGreen.toFixed(2)} in the page area, ${toolsGreen.toFixed(2)} in the DevTools area)`);
        const along = side === "bottom" ? "height" : "width";
        const shift = side === "bottom" ? { x: 0, y: -150 } : { x: -150, y: 0 };
        let moved = 0;
        let grabbed = null;
        for (const offset of side === "bottom" ? [1, 3, -1] : side === "right" ? [1, 3, -1] : [-1, -3, -6, 1, 3]) {
          const now = await probe(app, urlA, "({ width: innerWidth, height: innerHeight })");
          const grab = { x: verdict.splitter.x + (side === "bottom" ? 0 : offset), y: verdict.splitter.y + (side === "bottom" ? offset : 0) };
          await desktop.drag(grab, { x: grab.x + shift.x, y: grab.y + shift.y });
          await delay(800);
          const after = await probe(app, urlA, "({ width: innerWidth, height: innerHeight })");
          moved = now[along] - after[along];
          if (Math.abs(moved) > 20) { grabbed = offset; break; }
        }
        if (Math.abs(Math.abs(moved) - 150) > 8) throw new Error(`${side}: dragging the splitter 150 px changed the page ${along} by ${moved}`);
        seen[side] = { page: before.size, moved, grabbed };
      }
      return seen;
    });

    await t.check("the find bar draws over docked DevTools", async () => {
      if (!frontend) throw new Error("DevTools didn't open");
      await dockTo(desktop, window, shell, tabA, frontend.session, "Dock to right");
      const { pane, size } = await layout(desktop, window, shell, tabA, app, urlA);
      await focusA();
      const before = await desktop.capture();
      await desktop.key("ctrl+f");
      await until(async () => (await findState(shell, tabA))?.open, { timeout: 5000, label: "pane A's find bar" });
      await delay(800);
      const field = await until(() => shell.rect("input[placeholder='Find on Page']"), { timeout: 5000, label: "the find field" });
      const frame = await currentRect(desktop, window);
      const bar = { x: frame.x + field.left, y: frame.y + field.top, width: field.width, height: field.height };
      const after = await desktop.capture();
      await shot(t, desktop, "find-over-devtools");
      const toolsLeft = pane.x + size.width;
      const overTools = { x: Math.max(bar.x, toolsLeft), y: bar.y, width: bar.x + bar.width - Math.max(bar.x, toolsLeft), height: bar.height };
      await desktop.key("escape");
      if (overTools.width < 20) throw new Error(`the find bar ${JSON.stringify(bar)} doesn't reach over docked DevTools (which starts at x ${toolsLeft}), so the overlay can't be checked`);
      const changed = differingFraction(before, after, overTools);
      if (changed < 0.05) throw new Error(`the find bar's part over DevTools didn't change on screen (${changed.toFixed(3)})`);
      return { bar, overlap: overTools.width, changed };
    });

    await t.check("closing docked DevTools with its close button returns keyboard focus to pane A", async () => {
      if (!frontend) throw new Error("DevTools didn't open");
      await clickFrontend(desktop, window, shell, tabA, frontend.session, "Close");
      await until(async () => (await frontends(app)).length === 0, { timeout: 10000, label: "DevTools to close" });
      const focus = await until(() => probe(app, urlA, "document.hasFocus()"), { timeout: 5000, label: "pane A's page to have focus" });
      return { focus };
    });

    await t.check("Save as… from pane B's context menu writes pane B as Webpage, Complete and as Webpage, Single File", async () => {
      const results = {};
      for (const [filter, name] of [["Webpage, Complete", `complete-${run}.html`], ["Webpage, Single File", `single-${run}.mhtml`]]) {
        await portal.pick("SaveFile", [join(saves, name)], { filter });
        await focusB();
        const pane = await paneRect(shell, tabB);
        const frame = await currentRect(desktop, window);
        const point = { x: frame.x + pane.left + pane.width * 0.3, y: frame.y + pane.top + pane.height * 0.4 };
        const { region } = await promptAfter(desktop, () => desktop.click(point.x, point.y, "right"), { settle: 1200 });
        if (!region || region.width < 150 || region.height < 150) throw new Error(`no context menu appeared: ${JSON.stringify(region)}`);
        await shot(t, desktop, `context-menu-${filter.split(", ")[1].toLowerCase().replace(/ /g, "-")}`);
        const count = (await portal.calls()).filter((c) => c.method === "SaveFile").length;
        const saveRequest = () => until(async () => (await portal.calls()).filter((c) => c.method === "SaveFile")[count] ?? false, { timeout: 5000, label: "a SaveFile request from Save as…" });
        const choose = async (dy) => {
          await desktop.pointerMove(point.x + 45, point.y + dy - 10);
          await delay(300);
          await desktop.click(point.x + 55, point.y + dy);
        };
        await choose(74);
        let call = await saveRequest().catch(() => null);
        if (!call) {
          await desktop.key("escape");
          await delay(500);
          await desktop.click(point.x, point.y, "right");
          await delay(1200);
          await choose(106);
          call = await saveRequest().catch(async (error) => { await desktop.key("escape"); throw error; });
        }
        const file = join(saves, name);
        await until(() => stat(file).then((s) => s.size > 0, () => false), { timeout: 20000, label: `${name} on disk` });
        await delay(1000);
        const text = await readFile(file, "latin1");
        if (!text.includes(`b-${run}`)) throw new Error(`${name} doesn't contain pane B's label`);
        if (text.includes("Tint background")) throw new Error(`${name} contains pane A`);
        if (filter === "Webpage, Single File" && !/Content-Type: image\/png/i.test(text)) throw new Error(`${name} doesn't carry the page's image`);
        results[filter] = { file: name, files: await savedPage(saves, name.replace(/\.html$/, "")), title: call.title, suggested: call.options.current_name };
      }
      const folder = results["Webpage, Complete"].files.find((n) => n.endsWith("_files"));
      if (!folder) throw new Error(`no _files folder beside the complete page: ${JSON.stringify(results["Webpage, Complete"].files)}`);
      return results;
    });

    const print = await systemPrint(t, desktop, window, shell, app, urlB, tabB).catch((error) => ({ error: error.message }));
    if (print.error || print.shown) {
      await t.check("Print Using System Dialog (Ctrl+Alt+P) on pane B shows a system print dialog", () => {
        if (print.error) throw new Error(print.error);
        return print;
      });
      if (print.shown) t.manual("System print dialog prints the correct pane", ["In the dialog that opened, choose Print to File and check the PDF holds pane B's text."], "the dialog opened; driving GTK's Print to File isn't scripted yet");
    } else if (!print.calibration.shown) {
      t.manual("System print dialog prints the correct pane", steps.print, `neither Ardia nor ${print.calibration.version} opens a print dialog from Print Using System Dialog in the private session (no printer queue), while a plain GtkPrintOperation dialog does appear there`);
    } else {
      await t.check("Print Using System Dialog (Ctrl+Alt+P) on pane B shows a system print dialog", () => { throw new Error(`no print dialog from Ardia, while stock Chromium shows one: ${JSON.stringify(print.calibration)}`); });
    }

    await t.check("Undock into separate window opens DevTools in its own window and Toggle reveals it", async () => {
      await focusA();
      await desktop.key("ctrl+shift+i");
      const docked = await frontendSession(app);
      const known = await desktop.windows();
      await dockTo(desktop, window, shell, tabA, docked.session, "Undock into separate window");
      const undocked = await newWindow(desktop, known, { timeout: 10000, label: "an undocked DevTools window" }).catch(async (error) => {
        await until(() => app.exited, { timeout: 12000, label: "Ardia to exit" }).catch(() => {});
        throw new Error(app.exited ? `no DevTools window, and Ardia exited (${app.exitCode}) after Undock (#257)` : error.message);
      });
      await focusA();
      await desktop.key("ctrl+shift+i");
      const focused = await until(async () => (await desktop.focused())?.id === undocked.id, { timeout: 5000, label: "Toggle DevTools to focus the undocked window" });
      return { title: undocked.title, focused };
    });
    if (!app.exited) await t.stop(app);
  },
};

async function systemPrint(t, desktop, window, shell, app, url, tabId) {
  await focusPageByClick(desktop, window, shell, app, url, tabId);
  const known = await desktop.windows();
  const { region } = await promptAfter(desktop, () => desktop.key("ctrl+alt+p"), { settle: 6000 });
  const added = (await desktop.windows()).filter((w) => !known.some((k) => k.id === w.id));
  await shot(t, desktop, "system-print");
  const screen = await desktop.capture();
  const dialogLike = region && region.width >= 300 && region.height >= 200 && region.width <= screen.width * 0.8 && region.height <= screen.height * 0.9;
  if (added.length || dialogLike) return { shown: true, windows: added.map((w) => w.title), region };
  return { shown: false, calibration: await stockChromiumPrints(t, desktop) };
}

async function stockChromiumPrints(t, desktop) {
  const chromium = process.env.ARDIA_ACCEPTANCE_CHROMIUM ?? "/usr/bin/chromium";
  const version = (await desktop.run(chromium, ["--version"]).catch(() => "stock Chromium")).trim();
  const dir = await t.scratch("stock-chromium");
  const known = await desktop.windows();
  const proc = desktop.spawn(chromium, [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--ozone-platform=wayland", "--password-store=basic", ...t.fixtures.chromiumArgs, t.fixtures.url.print()], { name: "stock-chromium-print", env: { CUPS_SERVER: join(dir, "no-cups") } });
  try {
    const window = await newWindow(desktop, known, { timeout: 20000, label: "stock Chromium's window" });
    await delay(2500);
    const frame = await currentRect(desktop, window);
    await desktop.click(frame.x + frame.width * 0.6, frame.y + frame.height * 0.7);
    await delay(400);
    const before = await desktop.windows();
    await desktop.key("ctrl+shift+p");
    await delay(6000);
    const added = (await desktop.windows()).filter((w) => !before.some((k) => k.id === w.id));
    return { version, shown: added.length > 0, windows: added.map((w) => w.title) };
  } finally {
    try { process.kill(-proc.child.pid, "SIGTERM"); } catch {}
    await until(async () => !(await desktop.windows()).some((w) => w.appId === "chromium"), { timeout: 8000, label: "stock Chromium to quit" }).catch(() => {});
  }
}

export function certificateFacts(cert) {
  const date = (text) => new Date(text).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return {
    issuedTo: cert.subject?.CN ?? null,
    organization: cert.subject?.O ?? null,
    issuedBy: cert.issuer?.CN ?? null,
    validFrom: date(cert.valid_from),
    expires: date(cert.valid_to),
    sha256: cert.fingerprint256.replace(/:/g, " "),
  };
}

export function panelFacts(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const after = (label) => {
    const at = lines.indexOf(label);
    return at >= 0 ? lines[at + 1] ?? null : null;
  };
  return { issuedTo: after("Issued to"), organization: after("Organization"), issuedBy: after("Issued by"), validFrom: after("Valid from"), expires: after("Expires"), sha256: after("SHA-256") };
}

export function compareCertificate(served, shown) {
  const problems = [];
  for (const key of ["issuedTo", "organization", "issuedBy", "validFrom", "expires"]) if (served[key] !== shown[key]) problems.push(`${key}: shown ${JSON.stringify(shown[key])}, served ${JSON.stringify(served[key])}`);
  const prefix = (shown.sha256 ?? "").replace(/…$/, "").trim();
  if (prefix.length < 23 || !served.sha256.startsWith(prefix)) problems.push(`SHA-256: shown ${JSON.stringify(shown.sha256)}, served ${served.sha256}`);
  return problems;
}

function servedCertificate(port, servername) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert);
    });
    socket.once("error", reject);
  });
}

export const f03Desktop = {
  id: "F03D",
  issue: 13,
  desktop: true,
  title: "The certificate details shown in Site Controls match the certificate the server presents, read in a private sway session",
  deadline: 180000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("Certificate details match the served certificate", ["Open an HTTPS page, Site Controls › Connection Details: issuer, validity and fingerprint match the served certificate."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const url = t.fixtures.url.secure();
    const { shell } = await startDesktopBrowser(t, desktop, { name: "certificate", session: sessionSeed({ windows: [{ id: "main", urls: [url] }] }) });
    const window = await ardiaWindow(desktop);
    await t.check("Site Controls › Connection Details shows the served certificate's subject, issuer, validity and SHA-256", async () => {
      const served = certificateFacts(await servedCertificate(t.fixtures.ports.https, "secure.ardia.test"));
      await openSiteControls(desktop, window, shell);
      await clickLabelIn(desktop, window, shell, "Connection Details");
      const text = await until(async () => { const x = await shell.text(); return x.includes("SHA-256") ? x : false; }, { timeout: 8000, label: "the certificate details" });
      await shot(t, desktop, "certificate-details");
      const shown = panelFacts(text);
      await t.evidence("certificate", { served, shown });
      const problems = compareCertificate(served, shown);
      if (problems.length) throw new Error(problems.join("; "));
      return { shown, served };
    });
  },
};

export const w76Desktop = {
  id: "W76D",
  issue: 76,
  desktop: true,
  title: "DevTools asked for with Ctrl+Alt+I right after Ctrl+T, a typed URL and Enter docks in the new tab's pane with keyboard focus, in a private sway session",
  deadline: 180000,
  async run(t) {
    const missing = await desktopUnavailable();
    if (missing) {
      t.manual("DevTools on a fresh tab", ["Press Ctrl+T, type a URL and Enter, then Ctrl+Alt+I at once: DevTools docks in that tab's pane with focus and nothing appears behind Ardia's window."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "fresh-devtools", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1, "w76d")] }] }) });
    const window = await ardiaWindow(desktop);
    await t.check("Ctrl+T, a typed URL, Enter and Ctrl+Alt+I open DevTools docked in the new tab with keyboard focus and no other window", async () => {
      const url = t.fixtures.url.tint("background");
      await focusPageByClick(desktop, window, shell, app, t.fixtures.url.page(1, "w76d"), await shell.activeTabId());
      const before = await desktop.windows();
      await desktop.key("ctrl+t");
      await delay(700);
      await desktop.type(url);
      await desktop.key("return");
      await desktop.key("ctrl+alt+i");
      const tabId = await shell.waitState(`return Object.values(s.tabs).find((x) => x.url === ${js(url)})?.id ?? false;`, { timeout: 15000, label: "the new tab on the typed URL" });
      await app.pageLoaded(url);
      const { session } = await frontendSession(app);
      const target = (await app.targets()).find((x) => x.url === url);
      if (!(await attachedTo(app, target.id))) throw new Error("DevTools doesn't inspect the new tab");
      const focus = await until(() => evaluate(session, "document.hasFocus()", { userGesture: false }), { timeout: 8000, label: "keyboard focus in the docked DevTools" });
      const after = await desktop.windows();
      if (after.length !== before.length) throw new Error(`windows changed: ${JSON.stringify(after.map((w) => w.title))}`);
      const box = await layout(desktop, window, shell, tabId, app, url);
      const verdict = dockVerdict("right", box);
      await shot(t, desktop, "fresh-tab-devtools");
      if (verdict.problems.length) throw new Error(verdict.problems.join("; "));
      const green = greenWhere(box.image, verdict.page);
      if (green < 0.6) throw new Error(`the page area isn't the page (green ${green.toFixed(2)})`);
      return { focus, page: box.size, pane: box.pane };
    });
  },
};
