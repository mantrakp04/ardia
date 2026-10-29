import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBrowser } from "../lib/flows.mjs";
import { js, until } from "../lib/util.mjs";

const DEVTOOLS = (t) => t.url.startsWith("devtools://") || t.url.startsWith("chrome-devtools://");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function finishedDownload(shell, filename) {
  return until(async () => (await shell.state("return s.downloads ?? [];")).find((d) => d.state === "finished" && d.path?.endsWith(filename)) ?? false,
    { timeout: 25000, label: `download ${filename} to finish` });
}

async function separateVolume(scratch) {
  const [here, there] = await Promise.all([stat(scratch), stat("/dev/shm").catch(() => null)]);
  return there && there.dev !== here.dev ? "/dev/shm" : null;
}

export const w74 = {
  id: "W74",
  issue: 74,
  title: "The download folder picker returns a validated folder or nothing",
  deadline: 120000,
  manual: [
  ],
  async run(t) {
    const { shell } = await startBrowser(t, { name: "picker" });
    await t.check("the host advertises the picker", async () => {
      const advertised = await shell.eval("__ardiaHost.bootstrap.capabilities.includes('ArdiaShell.pickFolder')");
      if (!advertised) throw new Error("ArdiaShell.pickFolder is not advertised");
      return true;
    }, { critical: true });
    await t.check("a background instance logs the request and returns no folder instead of showing a dialog", async () => {
      const reply = await shell.invoke("ArdiaShell.pickFolder", { args: ["/tmp", "Use Folder"] });
      if (!reply.ok || reply.value !== null) throw new Error(`pickFolder answered ${JSON.stringify(reply)}`);
      return reply;
    });
    await t.check("malformed requests are refused", async () => {
      const reply = await shell.invoke("ArdiaShell.pickFolder", { args: [42] });
      if (reply.ok || reply.code !== "ERR_FOLDER_REQUEST") throw new Error(`pickFolder answered ${JSON.stringify(reply)}`);
      return reply;
    });
  },
};

export const w75 = {
  id: "W75",
  issue: 75,
  title: "Downloads: per-volume trash and reveal failures that are reported",
  deadline: 240000,
  async run(t) {
    const scratch = await t.scratch("volume");
    const bin = join(scratch, "launcher-bin");
    await mkdir(bin, { recursive: true });
    for (const tool of ["/bin/sh", "/usr/bin/dirname"]) await symlink(await realpath(tool), join(bin, tool.split("/").pop()));
    const volume = await separateVolume(scratch);
    const downloads = volume ? await mkdtemp(join(volume, "ardia-acceptance-")) : join(scratch, "downloads");
    await mkdir(downloads, { recursive: true });
    const trash = volume ? join(volume, `.Trash-${process.getuid()}`) : null;
    const trashExisted = trash ? await stat(trash).then(() => true, () => false) : true;
    try {
      const { shell } = await startBrowser(t, {
        name: "files",
        preferences: { downloads },
        extraArgs: [`--ardia-downloads-dir=${downloads}`],
        env: { PATH: bin },
      });
      const tabId = await shell.state("const w = s.windows[windowId]; return w.activeTabIds[w.profileId];");
      await shell.navigate(tabId, t.fixtures.url.download("volume.bin"));
      const download = await finishedDownload(shell, "volume.bin");
      await t.check("Show in Folder without any desktop handler reports why", async () => {
        const reply = await shell.invoke("ArdiaSystem.revealFile", { args: [download.path] });
        if (reply.ok || reply.code !== "ERR_REVEAL_UNAVAILABLE") throw new Error(`revealFile answered ${JSON.stringify(reply)}`);
        return reply;
      });
      if (!volume) {
        t.manual("Move to Trash on another file system", ["Download a file to a USB drive or another partition and choose Move to Trash.", "The file moves to that volume's .Trash-<uid>/files (or .Trash/<uid> when .Trash is a sticky folder) with a relative .trashinfo record."], "/dev/shm is not a separate mount here");
        return;
      }
      await t.check("Move to Trash uses the download's own volume trash", async () => {
        const reply = await shell.invoke("ArdiaSystem.moveToTrash", { args: [download.path] });
        if (!reply.ok) throw new Error(`moveToTrash failed: ${reply.code} ${reply.message}`);
        const files = await readdir(join(trash, "files"));
        const name = files.find((f) => f.startsWith("volume"));
        if (!name) throw new Error(`nothing in ${trash}/files: ${JSON.stringify(files)}`);
        const gone = await stat(download.path).then(() => false, () => true);
        if (!gone) throw new Error("the original file is still there");
        await unlink(join(trash, "files", name));
        await unlink(join(trash, "info", `${name}.trashinfo`));
        return { trash, name };
      });
    } finally {
      if (volume) {
        if (!trashExisted) {
          for (const part of ["files", "info", ""]) await rmdir(join(trash, part)).catch(() => {});
        }
        await rm(downloads, { recursive: true, force: true });
      }
    }
  },
};

export const w156 = {
  id: "W156",
  issue: 156,
  title: "Downloads: a failed reveal is reported and volume trash survives a writable top directory",
  deadline: 240000,
  manual: [
    { name: "Trash on a writable removable drive", steps: ["Mount a drive whose top folder is writable by everyone and not sticky (for example vfat with umask=000) and download a file to it.", "Move to Trash puts it in that drive's .Trash-<uid>/files with a .trashinfo record, and a .Trash-<uid> another user created there is refused instead of used."], reason: "automated in W156R with a tmpfs drive in a user namespace; a physical drive needs a person" },
  ],
  async run(t) {
    const scratch = await t.scratch("reveal");
    const bin = join(scratch, "launcher-bin");
    await mkdir(bin, { recursive: true });
    for (const tool of ["/bin/sh", "/usr/bin/dirname", "/usr/bin/cat", "/usr/bin/pwd"]) await symlink(await realpath(tool), join(bin, tool.split("/").pop()));
    const exitFile = join(scratch, "xdg-open.exit");
    const log = join(scratch, "xdg-open.log");
    await writeFile(exitFile, "4");
    await writeFile(join(bin, "xdg-mime"), "#!/bin/sh\necho org.ardia.Files.desktop\n");
    await writeFile(join(bin, "xdg-open"), `#!/bin/sh\necho "$(pwd) $1" >> ${JSON.stringify(log)}\nexit "$(cat ${JSON.stringify(exitFile)})"\n`);
    await chmod(join(bin, "xdg-mime"), 0o755);
    await chmod(join(bin, "xdg-open"), 0o755);
    const downloads = join(scratch, "downloads");
    await mkdir(downloads, { recursive: true });
    const { shell } = await startBrowser(t, {
      name: "reveal",
      preferences: { downloads },
      extraArgs: [`--ardia-downloads-dir=${downloads}`],
      env: { PATH: bin },
    });
    const tabId = await shell.state("const w = s.windows[windowId]; return w.activeTabIds[w.profileId];");
    await shell.navigate(tabId, t.fixtures.url.download("reveal.bin"));
    const download = await finishedDownload(shell, "reveal.bin");
    await t.check("Show in Folder reports a folder app that fails", async () => {
      const reply = await shell.invoke("ArdiaSystem.revealFile", { args: [download.path] });
      if (reply.ok || reply.code !== "ERR_REVEAL_FAILED" || !/folder app/.test(reply.message ?? "")) throw new Error(`revealFile answered ${JSON.stringify(reply)}`);
      const ran = (await readFile(log, "utf8")).trim().split("\n");
      if (ran.at(-1) !== `${await realpath(downloads)} .`) throw new Error(`xdg-open ran as ${JSON.stringify(ran)}`);
      return { reply, ran };
    }, { critical: true });
    await t.check("Show in Folder succeeds when the folder app opens", async () => {
      await writeFile(exitFile, "0");
      const reply = await shell.invoke("ArdiaSystem.revealFile", { args: [download.path] });
      if (!reply.ok || reply.value !== true) throw new Error(`revealFile answered ${JSON.stringify(reply)}`);
      return reply;
    });
  },
};

export const w76 = {
  id: "W76",
  issue: 76,
  title: "Docked DevTools asked for before a pane's first viewport opens once the viewport arrives",
  deadline: 180000,
  async run(t) {
    const { app, shell } = await startBrowser(t, { name: "devtools", background: false });
    await t.check("DevTools requested before a new tab's first viewport opens and inspects it", async () => {
      const url = t.fixtures.url.page(3, "w76");
      await shell.eval(`new Promise((resolve) => { const s = ardiaLinux.store.getState(); const id = s.newTab(${js(shell.windowId)}, { url: ${js(url)} }); s.activate(id); const ask = () => { if (!ardiaLinux.webviews.has(id)) return setTimeout(ask, 0); ardiaLinux.emitCommand({ command: "devTools", windowId: ${js(shell.windowId)} }); resolve(id); }; ask(); })`);
      const frontend = await until(async () => (await app.browserTargets()).find(DEVTOOLS) ?? false, { timeout: 20000, label: "the DevTools frontend" });
      const page = await app.pageTarget((target) => target.url === url, { timeout: 20000, label: "the inspected page" });
      const attached = await until(async () => (await app.browserTargets()).find((target) => target.targetId === page.id)?.attached || false, { timeout: 10000, label: "the page to be inspected" });
      await delay(1000);
      await t.screenshot(shell, "w76-devtools").catch(() => {});
      return { frontend: frontend.url, attached };
    });
  },
};

export const w137 = {
  id: "W137",
  issue: 137,
  title: "An extension install prompt ends with the tab that asked for it",
  deadline: 60000,
  manual: [
    { name: "Closing the Web Store tab dismisses its prompt", steps: ["Open chromewebstore.google.com and choose Add to Ardia on any extension.", "While Ardia's dialog is open, close the Web Store tab (Ctrl+W from the sidebar).", "The dialog disappears and nothing is installed; the store's own Add flow reports it was cancelled."], reason: "needs network access to the Chrome Web Store" },
    { name: "A prompt with no tab stays until answered", steps: ["Install a packed CRX from Settings › Extensions › Install from file.", "The dialog stays open until Add or Cancel, whatever tabs close meanwhile."], reason: "needs a signed CRX" },
  ],
  async run(t) {
    const { shell } = await startBrowser(t, { name: "prompt" });
    await t.check("the extension service answers in this window", async () => {
      const reply = await shell.call("extensions.list", {});
      if (!reply.ok) throw new Error(`extensions.list failed: ${reply.code} ${reply.message}`);
      return { count: reply.value.length };
    });
  },
};
