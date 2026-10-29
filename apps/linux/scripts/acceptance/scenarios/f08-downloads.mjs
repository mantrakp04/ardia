import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { downloadById, duplicateIds } from "../lib/assertions.mjs";
import { restartBrowser, startBrowser } from "../lib/flows.mjs";
import { js, nonce, until } from "../lib/util.mjs";

const downloadsOf = (shell) => shell.state("return s.downloads ?? [];");

async function waitDownload(shell, test, label, timeout = 20000) {
  return until(async () => (await downloadsOf(shell)).find(test) ?? false, { timeout, label });
}

async function startDownload(shell, tabId, url, filename) {
  await shell.navigate(tabId, url);
  return waitDownload(shell, (d) => d.filename?.endsWith(filename) || d.path?.endsWith(filename), `download ${filename} to appear`);
}

async function control(shell, verb, id) {
  const reply = await shell.call(`downloads.${verb}`, { id });
  if (!reply.ok) throw new Error(`downloads.${verb} failed: ${reply.code} ${reply.message}`);
  return reply.value;
}

async function receivedStalls(shell, id) {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const first = downloadById(await downloadsOf(shell), id)?.received;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const second = downloadById(await downloadsOf(shell), id)?.received;
  return { first, second, stalled: first === second };
}

export default {
  id: "F08",
  issue: 18,
  title: "Downloads events, controls, settings and restart behaviour",
  deadline: 360000,
  manual: [
    { name: "Move to Trash from the row menu", steps: ["Right-click a finished download in Ctrl+J and choose Move to Trash.", "The file moves to ~/.local/share/Trash/files with a .trashinfo record and the row shows it as gone."], reason: "F08D drives Open and Show in Folder through a private session; Move to Trash is only in the row's native context menu" },
  ],
  async run(t) {
    const run = nonce("f08");
    const folder = await t.scratch("downloads");
    const other = join(folder, "other");
    await mkdir(other, { recursive: true });
    let state = await startBrowser(t, { name: "downloads", preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
    const page = t.fixtures.url.page(1, run);
    const tabId = await state.shell.newTab(page);
    await state.shell.waitTabUrl(tabId, (u) => u === page);

    const small = `small-${run}.bin`;
    let smallDownload;
    await t.check("a known file downloads to completion and is on disk", async () => {
      await startDownload(state.shell, tabId, t.fixtures.url.download(small, 65536), small);
      smallDownload = await waitDownload(state.shell, (d) => d.filename?.endsWith(small) && d.state === "finished", "small download to finish");
      const size = (await stat(smallDownload.path)).size;
      if (size !== 65536) throw new Error(`downloaded ${size} bytes`);
      const status = await state.shell.invoke("ArdiaSystem.fileStatus", { args: [[smallDownload.path]] });
      if (!status.ok || status.value?.[0] !== true) throw new Error(`fileStatus ${JSON.stringify(status)}`);
      return { path: smallDownload.path, size };
    }, { critical: true });
    await t.check("Ctrl+J shows the finished download", async () => {
      if (await state.shell.state("return s.windowUi[windowId]?.downloadsOpen === true;")) {
        await state.shell.command("downloads");
        await state.shell.waitState("return s.windowUi[windowId]?.downloadsOpen === false;", { timeout: 5000, label: "the auto-opened downloads popover to close" });
      }
      await state.shell.command("downloads");
      await state.shell.waitState("return s.windowUi[windowId]?.downloadsOpen === true;", { timeout: 5000, label: "downloads popover" });
      await until(async () => (await state.shell.text()).includes(small), { timeout: 5000, label: `${small} in the downloads list` });
      await state.shell.command("downloads");
      return true;
    });

    const slow = `slow-${run}.bin`;
    let slowDownload;
    await t.check("a slow download reports progress", async () => {
      await startDownload(state.shell, tabId, t.fixtures.url.slow(slow, 6 << 20), slow);
      slowDownload = await waitDownload(state.shell, (d) => d.filename?.endsWith(slow) && d.state === "downloading" && d.received > 0, "slow download progress");
      return { received: slowDownload.received, total: slowDownload.total };
    }, { critical: true });
    await t.check("pause stops progress", async () => {
      await control(state.shell, "pause", slowDownload.id);
      await waitDownload(state.shell, (d) => d.id === slowDownload.id && d.paused === true, "paused flag");
      const sample = await receivedStalls(state.shell, slowDownload.id);
      if (!sample.stalled) throw new Error(`still receiving while paused ${JSON.stringify(sample)}`);
      return sample;
    });
    await t.check("resume continues and completes", async () => {
      await control(state.shell, "resume", slowDownload.id);
      await waitDownload(state.shell, (d) => d.id === slowDownload.id && d.paused === false, "resumed flag");
      t.fixtures.release(slow);
      const done = await waitDownload(state.shell, (d) => d.id === slowDownload.id && d.state === "finished", "slow download to finish", 60000);
      const size = (await stat(done.path)).size;
      if (size !== 6 << 20) throw new Error(`downloaded ${size} bytes`);
      slowDownload = done;
      return { size };
    });

    const cancelled = `cancel-${run}.bin`;
    let cancelledDownload;
    await t.check("cancel stops a download and removes its partial file", async () => {
      const d = await startDownload(state.shell, tabId, t.fixtures.url.slow(cancelled, 6 << 20), cancelled);
      await waitDownload(state.shell, (x) => x.id === d.id && x.received > 0, "cancel candidate progress");
      await control(state.shell, "cancel", d.id);
      cancelledDownload = await waitDownload(state.shell, (x) => x.id === d.id && x.state === "cancelled", "cancelled state");
      const leftovers = () => readdir(folder).then((names) => names.filter((name) => name.includes(cancelled)));
      const left = await until(async () => ((await leftovers()).length ? false : []), { timeout: 5000, label: "the partial file to be deleted" }).catch(leftovers);
      if (left.length) throw new Error(`partial files left: ${left.join(", ")}`);
      return { id: d.id };
    });
    await t.check("remove forgets a finished download in the engine too", async () => {
      await state.shell.state(`s.removeDownload(${js(smallDownload.id)}); return true;`);
      await until(async () => !downloadById(await downloadsOf(state.shell), smallDownload.id), { timeout: 5000, label: "removed from the store" });
      const listed = await until(async () => {
        const reply = await state.shell.call("downloads.list", {});
        return reply.ok && !JSON.stringify(reply.value).includes(smallDownload.id) ? reply.value : false;
      }, { timeout: 8000, label: "removed from Chromium's download history" });
      return { remaining: Array.isArray(listed) ? listed.length : null };
    });
    await t.check("the destination folder setting changes where files land", async () => {
      const reply = await state.shell.call("downloads.setSettings", { folder: other });
      if (!reply.ok) throw new Error(`setSettings failed ${reply.code} ${reply.message}`);
      const name = `elsewhere-${run}.bin`;
      await startDownload(state.shell, tabId, t.fixtures.url.download(name, 2048), name);
      const done = await waitDownload(state.shell, (d) => d.filename?.endsWith(name) && d.state === "finished", "download into the new folder");
      if (!done.path.startsWith(other)) throw new Error(`landed in ${done.path}`);
      await state.shell.call("downloads.setSettings", { folder });
      return { path: done.path };
    });
    await t.check("clear removes finished and cancelled rows", async () => {
      await state.shell.state("s.clearDownloads(windowId); return true;");
      const left = await until(async () => {
        const list = await downloadsOf(state.shell);
        return list.every((d) => d.state === "downloading") ? list : false;
      }, { timeout: 5000, label: "cleared downloads" });
      return { left: left.length };
    });
    await t.check("restart restores no stale, live or duplicate downloads", async () => {
      const kept = `kept-${run}.bin`;
      await startDownload(state.shell, tabId, t.fixtures.url.download(kept, 1024), kept);
      const keptDownload = await waitDownload(state.shell, (d) => d.filename?.endsWith(kept) && d.state === "finished", "kept download");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      state = await restartBrowser(t, state, { preferences: { downloads: folder }, extraArgs: [`--ardia-downloads-dir=${folder}`] });
      const list = await until(async () => {
        const l = await downloadsOf(state.shell);
        return l.some((d) => d.id === keptDownload.id) ? l : false;
      }, { timeout: 15000, label: "the kept download after restart" });
      const problems = [];
      const dupes = duplicateIds(list);
      if (dupes.length) problems.push(`duplicates ${dupes.join(", ")}`);
      if (list.some((d) => d.state === "downloading")) problems.push("a download reports live after restart");
      for (const gone of [smallDownload?.id, slowDownload?.id, cancelledDownload?.id].filter(Boolean)) if (list.some((d) => d.id === gone)) problems.push(`cleared download ${gone} came back`);
      const popover = await state.shell.state("return s.windowUi[windowId]?.downloadsOpen ?? false;");
      if (popover) problems.push("restart opened the downloads popover");
      if (problems.length) throw new Error(problems.join("; "));
      return { count: list.length };
    });
  },
};
