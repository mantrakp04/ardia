import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { evaluate } from "../lib/cdp.mjs";
import { currentRect, desktopShot, desktopUnavailable, openDesktop, pointAt, settledRect, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { until } from "../lib/util.mjs";

const PEER = new URL("../lib/tools/dnd_peer.py", import.meta.url).pathname;
const NEW_TAB_ROW = "Open and recently closed tabs";
const LEFT_COLOR = [240, 16, 160];
const LINK_COLOR = [16, 200, 240];
const FIELD_COLOR = [20, 230, 120];
const LINK_TARGET = "https://dragged-link.ardia.test/";

async function events(log) {
  return (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function startPeer(t, desktop, mode, title, args) {
  const dir = await t.scratch(`peer-${mode}`);
  const log = join(dir, `${mode}.log`);
  desktop.spawn("python3", ["-I", PEER, mode, title, log, ...args], { name: `dnd-${mode}-${Date.now()}`, env: { GDK_BACKEND: desktop.kind === "x11" ? "x11" : "wayland" } });
  await until(async () => (await events(log)).some((e) => e.event === "ready"), { timeout: 15000, label: `the GTK drag ${mode}` });
  const window = await until(async () => (await desktop.windows()).find((w) => w.title === title) ?? false, { timeout: 10000, label: `the ${title} window` });
  if (desktop.kind === "x11") {
    await desktop.xdotool(["windowmove", String(window.id), "1320", "120"]);
    await delay(400);
  }
  return { log, title, window: async () => (await desktop.windows()).find((w) => w.title === title), events: () => events(log) };
}

async function stopPeer(desktop, peer) {
  const window = await peer.window();
  if (!window) return;
  if (desktop.kind === "x11") await desktop.xdotool(["windowkill", String(window.id)]).catch(() => {});
  else await desktop.command(`[con_id=${window.id}] kill`).catch(() => {});
  await until(async () => !(await peer.window()), { timeout: 5000, label: `${peer.title} to close` }).catch(() => {});
}

async function drag(desktop, from, to, { steps = 24, hover = 400, release = true, wiggle = true } = {}) {
  await desktop.pointerMove(from.x, from.y);
  await delay(150);
  await desktop.pointerPress();
  await delay(250);
  for (let i = 1; i <= steps; i++) {
    await desktop.pointerMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await delay(35);
  }
  if (wiggle) for (let i = 1; i <= 4; i++) { await desktop.pointerMove(to.x + i, to.y + i); await delay(60); }
  await delay(hover);
  if (release) await desktop.pointerRelease();
}

const center = (w) => ({ x: w.rect.x + w.rect.width / 2, y: w.rect.y + w.rect.height / 2 });
const tabUrls = (shell) => shell.state("const w = s.windows[windowId]; return (w?.tabIds ?? []).map((id) => s.tabs[id]?.url);");
const browserWindow = (desktop) => until(async () => (await desktop.windows()).find((w) => / - Ardia$/.test(w.title)) ?? false, { timeout: 15000, label: "the browser window" });

export const SIDEBAR_ROW_SCRIPT = (title) => `(() => {
  const want = ${JSON.stringify(title)};
  const text = (n) => (n.innerText ?? '').trim();
  let label = null;
  let area = Infinity;
  for (const n of document.body.querySelectorAll('*')) {
    if (text(n) !== want || n.closest('[data-testid="ardia-sidebar-hover"]')) continue;
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.width * r.height > area) continue;
    label = n;
    area = r.width * r.height;
  }
  if (!label) return null;
  let row = label;
  while (row.parentElement && row.parentElement !== document.body && text(row.parentElement) === want) row = row.parentElement;
  const r = row.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, width: r.width, height: r.height };
})()`;

async function rowOf(shell, title) {
  return settledRect(() => shell.eval(SIDEBAR_ROW_SCRIPT(title)), { timeout: 8000, label: `${title} at rest in the sidebar` });
}

export const reorderPoint = (row) => ({ x: row.x, y: row.top + Math.min(2, row.height / 8) });

async function recorderBin(dir) {
  const bin = join(dir, "bin");
  const log = join(dir, "xdg-open.log");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);
  await chmod(join(bin, "xdg-open"), 0o755);
  return { bin, calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean) };
}

async function dragOut(t, desktop) {
  const work = await t.scratch("drag-out");
  const downloads = join(work, "Downloads");
  const dropped = join(work, "dropped");
  await mkdir(downloads, { recursive: true });
  await mkdir(dropped, { recursive: true });
  const recorder = await recorderBin(work);
  const { app, shell } = await startDesktopBrowser(t, desktop, { name: "drag-out", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)], frame: [0, 0, 1200, 900] }] }), preferences: { downloads }, env: { PATH: `${recorder.bin}:${process.env.PATH}` } });
  const name = `dragged-${Date.now()}.bin`;
  await shell.navigate(await shell.activeTabId(), t.fixtures.url.download(name));
  await until(async () => { const r = await shell.call("downloads.list", {}); return (r.ok ? r.value : []).some((d) => (d.path ?? "").endsWith(name) && d.state === "finished"); }, { timeout: 30000, label: `${name} to finish` });
  const target = await startPeer(t, desktop, "target", "Drop Target", [dropped]);
  const browser = await browserWindow(desktop);
  const openRow = async () => {
    let row = await shell.rectByText(name, { exact: true });
    if (!row) {
      const button = await until(() => shell.eval("(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => /^Downloads/.test(n.getAttribute('aria-label') ?? n.getAttribute('title') ?? '') && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()"), { timeout: 8000, label: "the Downloads button" });
      await pointAt(desktop, browser, button);
      row = await until(() => shell.rectByText(name, { exact: true }), { timeout: 8000, label: "the download row in the popover" });
    }
    const frame = await currentRect(desktop, browser);
    return { x: frame.x + row.x, y: frame.y + row.y };
  };
  return { app, shell, name, downloads, dropped, target, recorder, browser, openRow };
}

async function dropIn(t, desktop, { layout }) {
  const work = await t.scratch(`drop-${layout}`);
  const files = [];
  for (const n of ["single", "one", "two", "three"]) {
    const file = join(work, `dropped-${n}.txt`);
    await writeFile(file, `dropped ${n}\n`);
    files.push(file);
  }
  const { app, shell } = await startDesktopBrowser(t, desktop, { name: `drop-${layout}`, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)], frame: [0, 0, 1200, 900] }], settings: layout === "top" ? { tabLayout: "top" } : {} }) });
  return { app, shell, files };
}

async function dropFiles(t, desktop, shell, files, point, label) {
  const peer = await startPeer(t, desktop, "source", `Drag Source ${label}`, files);
  try {
    const browser = await browserWindow(desktop);
    const frame = await currentRect(desktop, browser);
    const before = await tabUrls(shell);
    await drag(desktop, center(await peer.window()), { x: frame.x + point.x, y: frame.y + point.y });
    const wanted = files.map((f) => pathToFileURL(f).href);
    const after = await until(async () => { const urls = await tabUrls(shell); return wanted.every((u) => urls.includes(u)) ? urls : false; }, { timeout: 10000, label: `${files.length} file:// tabs` }).catch(async (error) => {
      throw new Error(`${error.message}; tabs ${JSON.stringify(await tabUrls(shell))}; source ${JSON.stringify(await peer.events())}`);
    });
    return { added: after.filter((u) => !before.includes(u)) };
  } finally {
    await stopPeer(desktop, peer);
  }
}

async function newTabRowTop(shell) {
  return shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => (n.getAttribute('aria-label') ?? n.getAttribute('title')) === ${JSON.stringify(NEW_TAB_ROW)}); return n ? Math.round(n.getBoundingClientRect().top) : null; })()`);
}

export function colorBox(image, rgb, tolerance = 24) {
  let left = Infinity, top = Infinity, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y += 2) {
    for (let x = 0; x < image.width; x += 2) {
      const i = (y * image.width + x) * 3;
      if (Math.abs(image.data[i] - rgb[0]) < tolerance && Math.abs(image.data[i + 1] - rgb[1]) < tolerance && Math.abs(image.data[i + 2] - rgb[2]) < tolerance) {
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left, height: bottom - top };
}

function pagesServer() {
  const [r, g, b] = LEFT_COLOR;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url.startsWith("/link")) response.end(`<!doctype html><title>Link page</title><body style="margin:0;background:rgb(${r},${g},${b})"><a id="link" href="${LINK_TARGET}" style="position:absolute;left:40px;top:40px;width:200px;height:40px;display:block;background:rgb(${LINK_COLOR.join(",")});font:20px sans-serif">Drag this link</a></body>`);
    else response.end(`<!doctype html><title>Field page</title><body style="margin:0"><input id="field" style="position:absolute;left:0;top:0;width:100%;height:200px;font:20px sans-serif;background:rgb(${FIELD_COLOR.join(",")});border:0" placeholder="drop here"></body>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function runDragChecks(t, { x11 }) {
  const missing = await desktopUnavailable({ x11, needs: x11 ? [] : ["grim"] });
  if (missing) {
    t.manual("Drag a downloaded file out to another application", ["Drag a finished download into another application's window: the file arrives."], missing);
    t.manual("Drop real files from a file manager", ["Drag one, then three files onto the sidebar and the top strip: each opens as a file:// tab."], missing);
    if (!x11) t.manual("Internal reorder and page drops still work", ["Reorder a sidebar tab, drag a tab onto the page to split, drag a link onto a text field."], missing);
    return;
  }
  const desktop = await openDesktop(t, { x11 });
  const shot = (name) => desktopShot(t, desktop, `${x11 ? "x11" : "sway"}-${name}`);

  const out = await dragOut(t, desktop);
  await t.check("pressing and holding a finished download row opens nothing, and releasing before the drag threshold starts no drag", async () => {
    const row = await out.openRow();
    await desktop.pointerMove(row.x, row.y);
    await delay(150);
    await desktop.pointerPress();
    await delay(1200);
    const whileHeld = await out.recorder.calls();
    await desktop.pointerMove(row.x + 2, row.y + 1);
    await delay(150);
    await desktop.pointerRelease();
    await delay(1500);
    const seen = await out.target.events();
    if (whileHeld.length) throw new Error(`the press opened ${JSON.stringify(whileHeld)}`);
    if (seen.some((e) => e.event === "motion" || e.event === "drop")) throw new Error(`a drag reached the target: ${JSON.stringify(seen)}`);
    return { opensWhileHeld: whileHeld.length, afterRelease: (await out.recorder.calls()).length };
  });
  await t.check("dragging the row onto another application's window drops the file's URI and the file copies there", async () => {
    await desktop.key("escape").catch(() => {});
    await delay(500);
    const row = await out.openRow();
    await drag(desktop, row, center(await out.target.window()), { steps: 30 });
    const drop = await until(async () => (await out.target.events()).find((e) => e.event === "drop") ?? false, { timeout: 10000, label: "the drop in the GTK target" }).catch(async (error) => { await shot("drag-out-missing"); throw error; });
    await shot("drag-out");
    const copied = await readdir(out.dropped);
    if (!drop.uris.some((u) => u.endsWith(`/${out.name}`)) || !copied.includes(out.name)) throw new Error(JSON.stringify({ drop, copied }));
    if (drop.target !== "text/uri-list") throw new Error(`dropped as ${drop.target}`);
    return { uris: drop.uris.length, copied };
  });
  await stopPeer(desktop, out.target);
  await t.stop(out.app);

  for (const layout of ["sidebar", "top"]) {
    const drop = await dropIn(t, desktop, { layout });
    const point = layout === "top" ? { x: 700, y: 18 } : { x: 90, y: 400 };
    if (layout === "sidebar") {
      await t.check("dragging a file over the sidebar opens a drop slot, and leaving clears it", async () => {
        const peer = await startPeer(t, desktop, "source", "Drag Source hover", [drop.files[0]]);
        try {
          const browser = await browserWindow(desktop);
          const frame = await currentRect(desktop, browser);
          const resting = await newTabRowTop(drop.shell);
          const start = center(await peer.window());
          await drag(desktop, start, { x: frame.x + point.x, y: frame.y + point.y }, { release: false });
          const open = await until(async () => { const top = await newTabRowTop(drop.shell); return top !== null && top > resting + 10 ? top : false; }, { timeout: 4000, label: "the drop slot under the pointer" });
          await shot("drop-slot");
          for (let i = 1; i <= 20; i++) { await desktop.pointerMove(frame.x + point.x + ((start.x - frame.x - point.x) * i) / 20, frame.y + point.y + ((start.y - frame.y - point.y) * i) / 20); await delay(30); }
          await delay(500);
          const left = await newTabRowTop(drop.shell);
          await desktop.pointerRelease();
          await delay(800);
          const before = (await tabUrls(drop.shell)).filter((u) => u.startsWith("file:"));
          if (Math.abs(left - resting) > 2) throw new Error(`the slot stayed open after leaving: ${left} vs ${resting}`);
          if (before.length) throw new Error(`dropping back on the source opened ${JSON.stringify(before)}`);
          return { resting, open, afterLeaving: left };
        } finally {
          await stopPeer(desktop, peer);
        }
      });
    }
    await t.check(`dropping one file from a GTK drag source onto the ${layout === "top" ? "top tab strip" : "sidebar"} opens it as a file:// tab`, async () => {
      const result = await dropFiles(t, desktop, drop.shell, [drop.files[0]], point, `${layout} one`);
      if (result.added.length !== 1) throw new Error(JSON.stringify(result));
      return result;
    });
    await t.check(`dropping three files onto the ${layout === "top" ? "top tab strip" : "sidebar"} opens three file:// tabs`, async () => {
      const result = await dropFiles(t, desktop, drop.shell, drop.files.slice(1), point, `${layout} three`);
      await shot(`drop-three-${layout}`);
      if (result.added.length !== 3) throw new Error(JSON.stringify({ result, tabs: await tabUrls(drop.shell) }));
      return result;
    });
    await t.stop(drop.app);
  }

  if (x11) return;
  const server = await pagesServer();
  t.defer(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { app, shell } = await startDesktopBrowser(t, desktop, { name: "internal", session: sessionSeed({ windows: [{ id: "main", urls: [`${base}/field`], frame: [0, 0, 1920, 1080] }] }) });
  await until(async () => (await shell.text()).includes("Field page"), { timeout: 15000, label: "the field page's tab" });
  await shell.newTab(`${base}/link`);
  const browser = await browserWindow(desktop);
  await until(async () => (await shell.text()).includes("Link page") && (await shell.text()).includes("Field page"), { timeout: 15000, label: "both tabs titled" });
  await t.check("dragging a sidebar tab above another reorders them", async () => {
    const before = await tabUrls(shell);
    const field = await rowOf(shell, "Field page");
    const link = await rowOf(shell, "Link page");
    const frame = await currentRect(desktop, browser);
    const above = reorderPoint(field);
    await drag(desktop, { x: frame.x + link.x, y: frame.y + link.y }, { x: frame.x + above.x, y: frame.y + above.y }, { steps: 16 });
    const after = await until(async () => { const urls = await tabUrls(shell); return urls[0] !== before[0] ? urls : false; }, { timeout: 5000, label: "the order to change" });
    return { before: before.map((u) => u.split("/").pop()), after: after.map((u) => u.split("/").pop()) };
  });
  await t.check("dragging a sidebar tab onto the page makes a split", async () => {
    const field = await until(async () => {
      const [moved, link] = [await rowOf(shell, "Field page"), await rowOf(shell, "Link page")];
      return moved.top > link.top ? moved : false;
    }, { timeout: 8000, label: "the reordered Field page row at rest below Link page" });
    const frame = await currentRect(desktop, browser);
    await drag(desktop, { x: frame.x + field.x, y: frame.y + field.y }, { x: frame.x + frame.width * 0.85, y: frame.y + frame.height / 2 }, { steps: 30, hover: 800 });
    const split = await until(async () => { const s = await shell.state("return Object.values(s.splits ?? {});"); return s.length ? s : false; }, { timeout: 8000, label: "a split" });
    await delay(1500);
    await shot("split");
    return { splits: split.length };
  });
  await t.stop(app);
  const pair = await startDesktopBrowser(t, desktop, { name: "link-drop", session: sessionSeed({ windows: [{ id: "links", urls: [`${base}/link`] }, { id: "fields", urls: [`${base}/field`] }] }) });
  await t.check("dragging a link from a page in one window onto a text field in a page in another window drops its URL there", async () => {
    const windows = await until(async () => { const list = (await desktop.windows()).filter((w) => / - Ardia$/.test(w.title)); return list.length >= 2 ? list : false; }, { timeout: 15000, label: "two browser windows" });
    const fieldPage = await pair.app.pageSession((x) => x.url.startsWith(`${base}/field`));
    await pair.app.pageSession((x) => x.url.startsWith(`${base}/link`));
    await delay(1500);
    const boxes = await until(async () => {
      const image = await desktop.capture();
      const link = colorBox(image, LINK_COLOR);
      const field = colorBox(image, FIELD_COLOR);
      return link && field ? { link, field } : false;
    }, { timeout: 10000, label: "the link and the field on screen" });
    await drag(desktop, { x: boxes.link.x + 30, y: boxes.link.y + boxes.link.height / 2 }, { x: boxes.field.x + boxes.field.width / 2, y: boxes.field.y + boxes.field.height / 2 }, { steps: 30, hover: 600 });
    const value = await until(async () => { const v = await evaluate(fieldPage, "document.getElementById('field').value"); return v ? v : false; }, { timeout: 8000, label: "the field to receive the link" }).catch(async (error) => { await shot("link-drop-missing"); throw error; });
    await shot("link-drop");
    if (!value.includes(LINK_TARGET)) throw new Error(`the field has ${JSON.stringify(value)}`);
    return { value };
  });
  await t.stop(pair.app);
}

export const f20Desktop = {
  id: "F20D",
  issue: 30,
  desktop: true,
  title: "Drag and drop on sway with GTK peers: a download dragged out to a GTK drop target, real file drags from a GTK source onto the sidebar and top strip, sidebar reorder, tab-to-page split and link-to-field drops",
  deadline: 480000,
  run: (t) => runDragChecks(t, { x11: false }),
};

export const f20X11 = {
  id: "F20X",
  issue: 30,
  desktop: true,
  title: "Drag out to a GTK drop target and drops from a GTK drag source on X11 (Xvfb and openbox)",
  deadline: 360000,
  run: (t) => runDragChecks(t, { x11: true }),
};
