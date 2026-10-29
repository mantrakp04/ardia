import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { clickTextIn, currentRect, desktopShot, desktopUnavailable, inside, openDesktop, openSettingsWindow, pointAt, pressInPrompt, promptAfter, promptLike, startDesktopBrowser } from "../lib/desktopSession.mjs";
import { startFileManager, startPortal } from "../lib/desktopServices.mjs";
import { openDownloadsPopover } from "../lib/desktopUi.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { FIXTURE_NAME, listed, prepareExtension } from "./f09-extensions.mjs";
import { js, until } from "../lib/util.mjs";

const exists = (path) => stat(path).then(() => true, () => false);
const text = (shell) => shell.eval("document.body.innerText", { timeout: 3000 });

async function recorderBin(dir) {
  const bin = join(dir, "bin");
  const log = join(dir, "xdg-open.log");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);
  await chmod(join(bin, "xdg-open"), 0o755);
  return { bin, log, calls: async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean) };
}

async function rowControl(shell, title) {
  return shell.eval(`(() => {
    const want = ${js(title)};
    const labels = [...document.querySelectorAll('*')].filter((n) => (n.innerText ?? '').trim() === want && n.getBoundingClientRect().width > 0);
    const label = labels.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
    if (!label) return null;
    const box = label.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const candidates = [...document.querySelectorAll('[tabindex], [role], button, input')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 10 && r.width < 80 && r.height > 10 && r.height < 40 && r.left > box.right && Math.abs(r.top + r.height / 2 - middle) < 24;
    });
    const control = candidates.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!control) return null;
    const r = control.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);
}

async function explain(t, desktop, settings, portal, name, error) {
  await desktopShot(t, desktop, name);
  const lines = (await text(settings).catch(() => "")).split("\n").map((l) => l.trim()).filter(Boolean);
  const calls = portal ? await portal.calls().catch(() => []) : [];
  return new Error(`${error.message}; pane ${JSON.stringify(lines.slice(-30))}; portal ${JSON.stringify(calls.map((c) => ({ method: c.method, title: c.title, options: c.options })))}`);
}

async function downloadsList(shell) {
  const reply = await shell.call("downloads.list", {});
  return reply.ok ? reply.value : [];
}

async function waitDownload(shell, test, label, timeout = 30000) {
  return until(async () => (await downloadsList(shell)).find(test) ?? false, { timeout, label });
}

async function folderRow(settings) {
  const lines = (await text(settings)).split("\n").map((l) => l.trim());
  const at = lines.indexOf("Downloads folder");
  return at >= 0 ? lines.slice(at, at + 3).join(" | ") : null;
}

async function clickReveal(desktop, shell, path) {
  const window = await desktop.focused();
  const name = path.split("/").pop();
  let row = await shell.rectByText(name, { exact: true });
  if (!row) {
    await openDownloadsPopover(desktop, window, shell);
    row = await until(() => shell.rectByText(name, { exact: true }), { timeout: 8000, label: "the download row in the popover" });
  }
  const frame = await currentRect(desktop, window);
  await desktop.pointerMove(frame.x + row.x, frame.y + row.y);
  await delay(500);
  const reveal = await until(() => shell.eval(`(() => { const n = [...document.querySelectorAll('[aria-label],[title]')].find((n) => /^Show in (Folder|Files|Finder)/.test(n.getAttribute('aria-label') ?? n.getAttribute('title') ?? '') && n.getBoundingClientRect().width > 0); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: n.getAttribute('aria-label') ?? n.getAttribute('title') }; })()`), { timeout: 5000, label: "the row's Show in Folder button" });
  await pointAt(desktop, window, reveal);
  return reveal;
}

export const w74Desktop = {
  id: "W74D",
  issue: 74,
  desktop: true,
  title: "Settings › General › Downloads › Change… opens the portal folder dialog: pick, cancel and an unwritable folder (private portal)",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("Choosing and cancelling the download folder", ["Settings › General › Downloads › Change…: pick a folder, cancel, and pick one you can't write to."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const home = await t.scratch("folders");
    const first = join(home, "first");
    const chosen = join(home, "chosen");
    const locked = join(home, "locked");
    for (const dir of [first, chosen, locked]) await mkdir(dir, { recursive: true });
    await chmod(locked, 0o555);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "picker", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }), preferences: { downloads: first } });
    const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "General" });
    await settings.waitFor("document.body.innerText.includes('Downloads folder')", { timeout: 10000, label: "the Downloads section" });
    await t.check("Change… opens the portal's folder dialog at the current folder and the picked folder is used for the next download", async () => {
      await portal.pick("OpenFile", [chosen]);
      await clickTextIn(desktop, window, settings, "Change…");
      const call = await until(async () => (await portal.calls()).find((c) => c.method === "OpenFile") ?? false, { timeout: 10000, label: "a FileChooser OpenFile request" });
      if (!call.options.directory) throw new Error(`the request isn't for a folder: ${JSON.stringify(call.options)}`);
      if (call.options.current_folder !== first) throw new Error(`the dialog opens at ${JSON.stringify(call.options.current_folder ?? null)}, not the current folder ${first}`);
      const row = await until(async () => {
        const r = await folderRow(settings);
        return r?.includes("chosen") ? r : false;
      }, { timeout: 10000, label: "the Downloads folder row to show the picked folder" });
      const name = `picked-${Date.now()}.bin`;
      await shell.navigate(await shell.activeTabId(), t.fixtures.url.download(name));
      await until(() => exists(join(chosen, name)), { timeout: 20000, label: `${name} in the picked folder` });
      return { row, currentFolder: call.options.current_folder ?? null, title: call.title };
    });
    await t.check("Cancel leaves the folder unchanged", async () => {
      const before = await folderRow(settings);
      const count = (await portal.calls()).length;
      await portal.cancel("OpenFile");
      await clickTextIn(desktop, window, settings, "Change…");
      await until(async () => (await portal.calls()).length > count, { timeout: 10000, label: "a second OpenFile request" });
      await delay(1500);
      const after = await folderRow(settings);
      if (after !== before) throw new Error(`the row changed from ${before} to ${after}`);
      return { row: after };
    });
    await t.check("an unwritable folder is explained, offers another choice, and leaves the setting unchanged", async () => {
      const before = await folderRow(settings);
      await portal.pick("OpenFile", [locked]);
      const { region } = await promptAfter(desktop, () => clickTextIn(desktop, window, settings, "Change…"), { settle: 2500 });
      await desktopShot(t, desktop, "unwritable-folder");
      if (!promptLike(region) || !inside(region, window.rect)) throw new Error(`no explanation over Settings: change ${JSON.stringify(region)}`);
      await portal.cancel("OpenFile");
      await pressInPrompt(desktop, region, ["escape"]);
      await delay(1500);
      const after = await folderRow(settings);
      if (after !== before) throw new Error(`the row changed from ${before} to ${after}`);
      return { prompt: region, row: after };
    });
    await t.stop(app);
    await chmod(locked, 0o755);
  },
};

export const f08Desktop = {
  id: "F08D",
  issue: 18,
  desktop: true,
  title: "Downloads in a desktop session: ask where to save through the portal, cancel, open with the desktop's handler, Show in Folder through FileManager1",
  deadline: 360000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("Ask where to save shows the native picker", ["With Ask where to save on, a download shows the save dialog; Cancel leaves no live row."], missing);
      t.manual("Open and Show in Folder act on the selected file", ["Click a finished row: the file opens. Show in Folder selects it in the file manager."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const files = await startFileManager(desktop);
    const work = await t.scratch("downloads");
    const folder = join(work, "Downloads");
    const elsewhere = join(work, "elsewhere");
    await mkdir(folder, { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    const recorder = await recorderBin(work);
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "downloads", session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }), preferences: { downloads: folder }, env: { PATH: `${recorder.bin}:${process.env.PATH}` } });
    const tab = await shell.activeTabId();
    await t.check("turning on Ask where to save in Settings makes a download ask the portal and save where it answers", async () => {
      const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "General" });
      const control = await until(() => rowControl(settings, "Ask where to save each file"), { timeout: 10000, label: "the Ask where to save toggle" });
      await pointAt(desktop, window, control);
      await delay(800);
      await desktopShot(t, desktop, "ask-where-to-save-on");
      await desktop.key("ctrl+w");
      await delay(800);
      const name = `asked-${Date.now()}.bin`;
      const target = join(elsewhere, name);
      await portal.pick("SaveFile", [target]);
      await shell.navigate(tab, t.fixtures.url.download(name));
      const call = await until(async () => (await portal.calls()).find((c) => c.method === "SaveFile") ?? false, { timeout: 20000, label: "a FileChooser SaveFile request" });
      await until(() => exists(target), { timeout: 20000, label: "the download at the answered path" });
      if (await exists(join(folder, name))) throw new Error("the file also landed in the default folder");
      return { currentName: call.options.current_name ?? null, currentFolder: call.options.current_folder ?? null };
    });
    await t.check("cancelling the save dialog leaves no live download row and no file", async () => {
      const name = `cancelled-${Date.now()}.bin`;
      await portal.cancel("SaveFile");
      const count = (await portal.calls()).filter((c) => c.method === "SaveFile").length;
      await shell.navigate(tab, t.fixtures.url.download(name));
      await until(async () => (await portal.calls()).filter((c) => c.method === "SaveFile").length > count, { timeout: 20000, label: "the second SaveFile request" });
      await delay(2500);
      const rows = (await downloadsList(shell)).filter((d) => (d.filename ?? d.path ?? "").includes(name));
      if (rows.some((d) => d.state === "downloading" || d.state === "finished")) throw new Error(`a row remains: ${JSON.stringify(rows)}`);
      for (const dir of [folder, elsewhere]) if ((await readdir(dir)).some((f) => f.includes(name))) throw new Error(`a file remains in ${dir}`);
      return { rows: rows.map((d) => d.state) };
    });
    let finished;
    await t.check("Show in Folder from the downloads popover asks FileManager1 to select the file", async () => {
      finished = await waitDownload(shell, (d) => d.state === "finished" && d.path?.startsWith(elsewhere), "the finished download");
      const reveal = await clickReveal(desktop, shell, finished.path);
      const calls = await until(async () => {
        const list = await files.calls();
        return list.length ? list : false;
      }, { timeout: 10000, label: "a FileManager1 call" });
      await desktopShot(t, desktop, "show-in-folder");
      const want = pathToFileURL(finished.path).href;
      if (calls[0].method !== "ShowItems" || !calls[0].uris.includes(want)) throw new Error(`FileManager1 got ${JSON.stringify(calls)}, wanted ShowItems ${want}`);
      return { label: reveal.label, call: calls[0] };
    });
    await t.check("clicking a finished row opens the file with the desktop's handler", async () => {
      const window = await desktop.focused();
      const row = await until(() => shell.rectByText(finished.path.split("/").pop(), { exact: true }), { timeout: 8000, label: "the download row" }).catch(async () => {
        await openDownloadsPopover(desktop, window, shell);
        return until(() => shell.rectByText(finished.path.split("/").pop(), { exact: true }), { timeout: 8000, label: "the download row after reopening the popover" });
      });
      await pointAt(desktop, window, row);
      const calls = await until(async () => {
        const list = await recorder.calls();
        return list.length ? list : false;
      }, { timeout: 10000, label: "xdg-open to run" });
      if (!calls.some((c) => c.includes(finished.path))) throw new Error(`xdg-open ran with ${JSON.stringify(calls)}`);
      return { calls };
    });
    await t.check("when FileManager1 fails and no folder app answers, Show in Folder says it couldn't show the file", async () => {
      await files.call("SetFail", [true], { signature: "b" });
      await writeFile(join(recorder.bin, "xdg-open"), "#!/bin/sh\nexit 4\n");
      const before = (await files.calls()).length;
      await clickReveal(desktop, shell, finished.path);
      await until(async () => (await files.calls()).length > before, { timeout: 10000, label: "the failing FileManager1 call" });
      const message = await shell.waitFor("(() => { const t = document.body.innerText; return t.includes(\"Couldn't Show the File\") ? t.split('\\n').filter((l) => /Couldn't Show|file manager|folder app|portal/i.test(l)).slice(0, 4) : false; })()", { timeout: 10000, label: "Couldn't Show the File" });
      await desktopShot(t, desktop, "show-in-folder-failed");
      return { message };
    });
    await t.stop(app);
  },
};

export const f09Desktop = {
  id: "F09D",
  issue: 19,
  desktop: true,
  title: "Settings › Extensions › Choose Folder… opens the portal folder dialog and the chosen fixture installs only after Ardia's dialog",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("Load unpacked through the folder picker", ["Settings › Extensions › Choose Folder… opens the native folder picker, and the chosen fixture folder installs after Ardia's dialog."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const source = await prepareExtension(join(await t.scratch("unpacked"), "fixture"));
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "extensions", extensions: true, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    let { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Extensions" });
    await settings.waitFor("document.body.innerText.includes('Add extensions')", { timeout: 10000, label: "the Extensions pane" });
    if (!(await text(settings)).includes("Choose Folder…")) {
      const advanced = await until(() => rowControl(settings, "Show advanced settings"), { timeout: 8000, label: "the Show advanced settings toggle" });
      await pointAt(desktop, window, advanced);
    }
    await settings.waitFor("document.body.innerText.includes('Choose Folder…')", { timeout: 10000, label: "the Choose Folder… row" }).catch(async (error) => {
      await desktopShot(t, desktop, "extensions-pane");
      throw new Error(`${error.message}; pane ${JSON.stringify((await text(settings)).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40))}`);
    });
    const answerDelay = 1.5;
    const pickAndWait = async (label) => {
      const before = (await portal.calls()).length;
      await portal.pick("OpenFile", [source], { delay: answerDelay });
      await clickTextIn(desktop, window, settings, "Choose Folder…");
      const call = await until(async () => (await portal.calls()).slice(before).find((c) => c.method === "OpenFile") ?? false, { timeout: 10000, label: `the ${label} OpenFile request` });
      if (!call.options.directory) throw new Error(`the request isn't for a folder: ${JSON.stringify(call.options)}`);
      await settings.waitFor(`document.body.innerText.includes(${js(`Add “${FIXTURE_NAME}”?`)})`, { timeout: 25000, label: `Ardia's Add dialog after the ${label} pick` }).catch(async (error) => { throw await explain(t, desktop, settings, portal, `unpacked-${label}-dialog`, error); });
      return call;
    };
    await t.check("Cancel in Ardia's dialog after picking the folder installs nothing", async () => {
      const call = await pickAndWait("first");
      await desktopShot(t, desktop, "unpacked-dialog");
      await clickTextIn(desktop, window, settings, "Cancel");
      await delay(1500);
      if (listed(await shell.call("extensions.list", {}))) throw new Error("Cancel installed the extension");
      return { title: call.title };
    });
    await t.check("choosing the folder again after Cancel shows Ardia's dialog again", async () => {
      await pickAndWait("second");
      await clickTextIn(desktop, window, settings, "Cancel");
      await delay(1000);
      return true;
    });
    await t.stop(app);
    const fresh = await startDesktopBrowser(t, desktop, { name: "extensions-add", extensions: true, session: sessionSeed({ windows: [{ id: "main", urls: [t.fixtures.url.page(1)] }] }) });
    ({ settings, window } = await openSettingsWindow(desktop, fresh.app, fresh.shell, { pane: "Extensions" }));
    if (!(await text(settings)).includes("Choose Folder…")) {
      const advanced = await until(() => rowControl(settings, "Show advanced settings"), { timeout: 8000, label: "the Show advanced settings toggle" });
      await pointAt(desktop, window, advanced);
      await settings.waitFor("document.body.innerText.includes('Choose Folder…')", { timeout: 10000, label: "the Choose Folder… row" });
    }
    await t.check("Add Extension in Ardia's dialog installs the chosen folder", async () => {
      await pickAndWait("add");
      await clickTextIn(desktop, window, settings, "Add Extension");
      const ext = await until(async () => listed(await fresh.shell.call("extensions.list", {})) ?? false, { timeout: 20000, label: "the fixture in extensions.list" });
      if (ext.path && !ext.path.startsWith(source)) throw new Error(`installed from ${ext.path}`);
      await desktopShot(t, desktop, "unpacked-installed");
      return { id: ext.id, path: ext.path ?? null };
    });
    await t.stop(fresh.app);
  },
};

const CSV_ROWS = [
  ["name", "url", "username", "password"],
  ["one.ardia.test", "https://one.ardia.test/login", "ada", "csv-secret-1"],
  ["two.ardia.test", "https://two.ardia.test/login", "grace", "csv-secret-2"],
  ["three.ardia.test", "https://three.ardia.test/", "linus", "csv-secret-3"],
  ["one.ardia.test", "https://one.ardia.test/login", "ada", "csv-secret-1"],
];

const BOOKMARKS_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
<DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
<DL><p>
<DT><H3 ADD_DATE="1700000000">Work</H3>
<DL><p>
<DT><A HREF="https://a.ardia.test/" ADD_DATE="1700000000">Alpha</A>
<DT><A HREF="https://b.ardia.test/" ADD_DATE="1700000000">Beta</A>
</DL><p>
<DT><A HREF="https://c.ardia.test/" ADD_DATE="1700000000">Gamma</A>
</DL><p>
</DL><p>
`;

const importedFolder = (shell) => shell.state(`const nodes = Object.values(s.bookmarks?.nodes ?? {}); const links = nodes.filter((n) => n.kind !== "folder" && ["Alpha", "Beta", "Gamma"].includes(n.title)); if (!links.length) return null; const work = nodes.find((n) => n.kind === "folder" && n.title === "Work"); const inWork = work ? (work.children ?? []).map((id) => s.bookmarks.nodes[id]?.title).filter(Boolean) : []; const wrapper = nodes.find((n) => n.kind === "folder" && n.title === "Imported from HTML File"); return { links: links.length, folders: work ? ["Work"] : [], inWork, wrapper: !!wrapper };`);

export const f12Desktop = {
  id: "F12D",
  issue: 22,
  desktop: true,
  title: "Settings › Passwords › Import CSV… through the portal: cancel imports nothing, three new rows and a duplicate import three, a second import adds none",
  deadline: 300000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("Passwords CSV import from Settings", ["Settings › Passwords › Import a CSV with three new logins and one duplicate row: the pane says Imported 3 passwords; again says Imported 0 passwords."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const { startPolkit } = await import("../lib/desktopServices.mjs");
    await startPolkit(desktop, { mode: "allow" });
    const csv = join(await t.scratch("csv"), "passwords.csv");
    await writeFile(csv, `${CSV_ROWS.map((row) => row.join(",")).join("\n")}\n`);
    const { app, shell, scratch: csvScratch } = await startDesktopBrowser(t, desktop, { name: "csv", session: sessionSeed() });
    const { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Passwords" });
    await settings.waitFor("document.body.innerText.includes('Import CSV…')", { timeout: 10000, label: "the Passwords pane" });
    const listed = async () => {
      const reply = await shell.invoke("ArdiaPasswords.list", { args: [""] });
      return reply.ok ? reply.value.filter((p) => /ardia\.test/.test(p.origin ?? p.url ?? "")) : [];
    };
    await t.check("cancelling the chooser imports nothing", async () => {
      await portal.cancel("OpenFile");
      await clickTextIn(desktop, window, settings, "Import CSV…");
      await until(async () => (await portal.calls()).some((c) => c.method === "OpenFile"), { timeout: 10000, label: "a FileChooser OpenFile request" }).catch(async (error) => { throw await explain(t, desktop, settings, portal, "csv-chooser-missing", error); });
      await delay(1500);
      if (/Imported \d+ password/.test(await text(settings))) throw new Error("the pane reports an import after Cancel");
      return { listed: (await listed()).length };
    });
    await t.check("three new logins and a duplicate row import three passwords", async () => {
      await portal.pick("OpenFile", [csv]);
      await clickTextIn(desktop, window, settings, "Import CSV…");
      const said = await settings.waitFor("(() => { const m = document.body.innerText.match(/Imported (\\d+) passwords?/); return m ? m[0] : false; })()", { timeout: 15000, label: "the import result" });
      if (said !== "Imported 3 passwords") throw new Error(`the pane says ${said}`);
      await clickTextIn(desktop, window, settings, "Unlock");
      await settings.waitFor("document.body.innerText.includes('one.ardia.test') && document.body.innerText.includes('three.ardia.test')", { timeout: 15000, label: "the imported logins in the list" });
      await desktopShot(t, desktop, "csv-imported");
      return { said };
    });
    await t.check("importing the same file again adds no passwords", async () => {
      await portal.pick("OpenFile", [csv]);
      await clickTextIn(desktop, window, settings, "Import CSV…");
      const said = await settings.waitFor("(() => { const m = document.body.innerText.match(/Imported (\\d+) passwords?/); return m && m[0] !== 'Imported 3 passwords' ? m[0] : false; })()", { timeout: 15000, label: "the second import result" });
      if (said !== "Imported 0 passwords") throw new Error(`the pane says ${said}`);
      return { said };
    });
    const html = join(await t.scratch("html"), "bookmarks.html");
    await writeFile(html, BOOKMARKS_HTML);
    let importer;
    let importWindow;
    await t.check("Settings › General › Import… opens the Import window and Bookmarks HTML File… asks the portal; Cancel imports nothing", async () => {
      await clickTextIn(desktop, window, settings, "General");
      await settings.waitFor("document.body.innerText.includes('Import…')", { timeout: 10000, label: "the Import… row" });
      const known = await desktop.windows();
      await clickTextIn(desktop, window, settings, "Import…");
      importer = await app.shell("import", { timeout: 20000 });
      importWindow = await until(async () => (await desktop.windows()).find((w) => !known.some((k) => k.id === w.id)) ?? false, { timeout: 15000, label: "the Import window" });
      await importer.waitFor("document.body.innerText.includes('Bookmarks HTML File…')", { timeout: 15000, label: "the chooser step" });
      const count = (await portal.calls()).length;
      await portal.cancel("OpenFile");
      await clickTextIn(desktop, importWindow, importer, "Bookmarks HTML File…");
      const call = await until(async () => (await portal.calls()).slice(count).find((c) => c.method === "OpenFile") ?? false, { timeout: 10000, label: "the bookmarks OpenFile request" });
      await delay(1500);
      if (!(await text(importer)).includes("Bookmarks HTML File…")) throw new Error("the window left the chooser step after Cancel");
      if (await importedFolder(shell)) throw new Error("Cancel imported bookmarks");
      return { title: call.title };
    });
    await t.check("choosing an exported bookmarks.html puts its 3 links and its Work folder in the browser window", async () => {
      await portal.pick("OpenFile", [html]);
      await clickTextIn(desktop, importWindow, importer, "Bookmarks HTML File…");
      await importer.waitFor("document.body.innerText.includes('Imported 3 bookmarks')", { timeout: 15000, label: "the Done step's count" }).catch(async (error) => { throw await explain(t, desktop, importer, portal, "bookmarks-done", error); });
      const own = await importedFolder(importer).catch(() => null);
      const folder = await until(() => importedFolder(shell), { timeout: 30000, label: `the imported links in the browser window (the Import window's own store has ${JSON.stringify(own)})` }).catch(async (error) => {
        await desktopShot(t, desktop, "bookmarks-html-missing");
        const titles = await shell.state("return Object.values(s.bookmarks?.nodes ?? {}).map((n) => `${n.kind}:${n.title}`).slice(0, 30);").catch((e) => e.message);
        throw new Error(`${error.message}; import window ${JSON.stringify((await text(importer).catch(() => "")).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20))}; bookmarks ${JSON.stringify(titles)}; portal ${(await portal.calls()).length}`);
      });
      await desktopShot(t, desktop, "bookmarks-html-done");
      if (folder.links !== 3) throw new Error(`the browser window has ${folder.links} of the 3 links: ${JSON.stringify(folder)}`);
      if (!folder.folders.includes("Work") || folder.inWork.join() !== "Alpha,Beta") throw new Error(`the Work folder was not kept: ${JSON.stringify(folder)}`);
      return folder;
    });
    await t.stop(app);
    await t.check("after a relaunch the browser window has the imported HTML bookmarks", async () => {
      const again = await startDesktopBrowser(t, desktop, { scratch: csvScratch, label: "relaunch" });
      const folder = await until(() => importedFolder(again.shell), { timeout: 20000, label: "the imported links after relaunch" }).catch(async (error) => {
        const titles = await again.shell.state("return Object.values(s.bookmarks?.nodes ?? {}).map((n) => `${n.kind}:${n.title}`).slice(0, 30);").catch((e) => e.message);
        throw new Error(`${error.message}; bookmarks ${JSON.stringify(titles)}`);
      });
      await t.stop(again.app);
      if (folder.links !== 3) throw new Error(`after relaunch ${folder.links} of the 3 links: ${JSON.stringify(folder)}`);
      if (!folder.folders.includes("Work") || folder.inWork.join() !== "Alpha,Beta") throw new Error(`the 3 links are there but the Work folder was not kept: ${JSON.stringify(folder)}`);
      return folder;
    });
  },
};

export const f13Desktop = {
  id: "F13D",
  issue: 23,
  desktop: true,
  title: "Settings › Sync › Choose… opens the portal folder dialog over Settings; the chosen folder is shown and kept, Cancel keeps the old one",
  deadline: 240000,
  async run(t) {
    const missing = await desktopUnavailable({ needs: ["dbusmock", "portal"] });
    if (missing) {
      t.manual("Choosing a folder from Settings", ["Settings › Sync › Choose… opens the folder picker over Settings and the chosen folder is used."], missing);
      return;
    }
    const desktop = await openDesktop(t);
    const portal = await startPortal(desktop);
    const chosen = join(await t.scratch("sync"), "Ardia Sync Folder");
    await mkdir(chosen, { recursive: true });
    const { app, shell } = await startDesktopBrowser(t, desktop, { name: "sync", session: sessionSeed() });
    let { settings, window } = await openSettingsWindow(desktop, app, shell, { pane: "Sync" });
    const row = async () => {
      const lines = (await text(settings)).split("\n").map((l) => l.trim());
      const at = lines.findIndex((l) => l === "Sync folder" || l === "Folder");
      return at >= 0 ? lines.slice(at, at + 2).join(" | ") : lines.find((l) => l.includes("Ardia Sync Folder")) ?? null;
    };
    await settings.waitFor("document.body.innerText.includes('Turn On Sync')", { timeout: 10000, label: "the Sync pane" });
    if (!(await text(settings)).includes("Choose…")) {
      const advanced = await until(() => rowControl(settings, "Show advanced settings"), { timeout: 8000, label: "the Show advanced settings toggle" });
      await pointAt(desktop, window, advanced);
    }
    await settings.waitFor("document.body.innerText.includes('Choose…')", { timeout: 10000, label: "the sync folder row" }).catch(async (error) => { throw await explain(t, desktop, settings, portal, "sync-pane", error); });
    await t.check("Choose… asks the portal for a folder and the pane shows the chosen one", async () => {
      await portal.pick("OpenFile", [chosen]);
      await clickTextIn(desktop, window, settings, "Choose…");
      const call = await until(async () => (await portal.calls()).find((c) => c.method === "OpenFile") ?? false, { timeout: 10000, label: "a FileChooser OpenFile request" });
      if (!call.options.directory) throw new Error(`not a folder request: ${JSON.stringify(call.options)}`);
      await settings.waitFor("document.body.innerText.includes('Ardia Sync Folder')", { timeout: 10000, label: "the chosen folder in the pane" }).catch(async (error) => { throw await explain(t, desktop, settings, portal, "sync-folder-missing", error); });
      return { title: call.title, row: await row() };
    });
    await t.check("Cancel keeps the chosen folder, and it is still chosen after reopening Settings", async () => {
      await portal.cancel("OpenFile");
      const count = (await portal.calls()).length;
      await clickTextIn(desktop, window, settings, "Choose…");
      await until(async () => (await portal.calls()).length > count, { timeout: 10000, label: "the second OpenFile request" });
      await delay(1500);
      if (!(await text(settings)).includes("Ardia Sync Folder")) throw new Error("Cancel cleared the folder");
      const closing = window;
      await desktop.key("ctrl+w");
      await until(async () => !(await app.shells()).some((s) => s.windowId === "settings") && !(await desktop.windows()).some((w) => w.id === closing.id), { timeout: 10000, label: "Ctrl+W to close Settings and its window" });
      let reused;
      ({ settings, window, reused } = await openSettingsWindow(desktop, app, shell, { pane: "Sync" }));
      if (reused || window.id === closing.id) throw new Error("Settings didn't reopen as a new window");
      await settings.waitFor("document.body.innerText.includes('Turn On Sync')", { timeout: 10000, label: "the Sync pane after reopening" });
      if (!(await text(settings)).includes("Choose…")) await pointAt(desktop, window, await until(() => rowControl(settings, "Show advanced settings"), { timeout: 8000, label: "the advanced toggle" }));
      await settings.waitFor("document.body.innerText.includes('Ardia Sync Folder')", { timeout: 10000, label: "the folder after reopening Settings" });
      return { row: await row() };
    });
    await t.stop(app);
  },
};
