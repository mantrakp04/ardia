import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node hover-shift-test.mjs <Debug Ardia.app> [cdpPort]");
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), "ac-hover-shift-"));
const data = join(scratch, "data");
mkdirSync(data);
const rep = reporter(join(scratch, "hover-shift-test.log"), { name: "hover-shift-test" });
const file = join(data, "report.pdf");
writeFileSync(file, "%PDF-1.4\n");

const ids = ["pin1", "pin2", "a1", "a2", "a3", "b1", "b2", ...Array.from({ length: 12 }, (_, i) => `t${i}`)];
const tab = (id) => {
  const pinned = id.startsWith("pin");
  return { id, url: `https://example.com/?${id}`, title: `Tab ${id} with a title long enough to fade`, pinned,
    pinnedUrl: pinned ? `https://example.com/?${id}` : null };
};

let app;
try {
  app = await launch(resolve(appArg), {
    data, port,
    session: session({ profiles: ["Personal", "Work"], windows: [{ id: "w1", tabIds: ids, activeTabIds: { default: "t2" } }], tabs: ids.map(tab) }),
    ready: "return !!ac.hoverShift",
  });
  const ac = (body) => app.eval(body, { timeout: 120000 });

  await ac(`
    const s = ac.store.getState();
    s.createGroup(["a1", "a2", "a3"], { name: "Open group" });
    const shut = s.createGroup(["b1", "b2"], { name: "Shut group", color: "blue" });
    s.updateGroup(shut, { collapsed: true });
    const { store, engine } = ac.live;
    const folder = store.createFolder("default", "pullRequests");
    const pr = (n, extra) => ({ number: n, repo: "ardia/app", author: "a", authorAvatar: null, draft: false, headRef: "h" + n, baseRef: "main",
      review: null, mergeable: "mergeable", checks: [], comments: 0, unresolvedThreads: 0, additions: 1, deletions: 1, changedFiles: 1, ...extra });
    const item = (n, extra) => ({ id: "pr" + n, source: "github", url: "https://example.com/pr/" + n, title: "Pull request " + n + " with a long title",
      subtitle: "", icon: null, updatedAt: Date.now() - n, section: "authored", pr: pr(n, extra) });
    const items = [item(1, { review: "approved" }), item(2, {}), item(3, { mergeable: "conflicting" })];
    store.applyFetch(folder, items, {});
    store.setStatus(folder, { state: "idle", lastFetch: Date.now(), error: null });
    engine.openLiveItem("w1", folder, items[1], { background: true });
    engine.openLiveItem("w1", folder, items[2], { background: true });
    ac.store.setState((st) => ({ downloads: [{ id: "d1", url: "https://example.com/report.pdf", filename: "report.pdf", path: ${JSON.stringify(file)},
      state: "finished", paused: false, received: 9, total: 9, speed: 0, mimeType: "application/pdf" }, ...st.downloads] }));
    return true;
  `);
  await sleep(1500);

  const surfaces = [
    ["sidebar", `ac.store.getState().updateSettings({ tabLayout: "sidebar" });`, ["Sidebar"]],
    ["tab strip", `ac.store.getState().updateSettings({ tabLayout: "top" });`, ["TopTabStrip"]],
    ["downloads", `ac.store.getState().updateSettings({ tabLayout: "sidebar" }); ac.store.getState().setDownloadsOpen("w1", true);`, ["DownloadsPopover"]],
  ];
  for (const [name, setup, scopes] of surfaces) {
    await rep.check(name, async () => {
      await ac(`${setup} return true;`);
      await sleep(1200);
      const { hovered, shifts } = await ac(`return ac.hoverShift.check({ scopes: ${JSON.stringify(scopes)} });`);
      if (!hovered) throw new Error("nothing hover-tracked found");
      if (shifts.length) {
        throw new Error([`${shifts.length} views moved or resized (${hovered} hovered)`,
          ...shifts.slice(0, 20).flatMap((s) => [`hovering ${s.hovered}`, `  ${s.view}: ${s.before.join(", ")} -> ${s.after.join(", ")}`])].join("\n"));
      }
      return `${hovered} hovered views, nothing moved`;
    });
  }

  const below = await ac(`
    const s = ac.store.getState();
    s.updateSettings({ tabLayout: "sidebar" });
    s.setDownloadsOpen("w1", false);
    const { store } = ac.live;
    const folder = store.live().folderOrder[0];
    store.updateFolder(folder, { after: null, collapsed: true });
    const group = s.groupTabs(["t10", "t11"], { pinned: true, name: "Below the folder" });
    ac.store.getState().updateGroup(group, { collapsed: true });
    return { folder, group };
  `);
  for (const addressBar of ["toolbar", "sidebar"]) {
    await rep.check(`a collapsed live folder's rows don't take the hover of the group below (address bar in the ${addressBar})`, async () => {
      const [group, header] = await ac(`
        ac.store.getState().updateSettings({ addressBar: "${addressBar}" });
        return new Promise((r) => setTimeout(r, 800))
          .then(() => Promise.all([ac.sidebarRows.measureRow("w1", "${below.group}"), ac.sidebarRows.measureRow("w1", "livefolder|${below.folder}")]));
      `);
      if (!group || !header) throw new Error("the folder or the group isn't in the sidebar");
      if (group.y <= header.y) throw new Error(`the group isn't below the folder (group y ${group.y}, folder y ${header.y})`);
      const card = await ac(`
        return ac.shell.devSetPointer("w1", { x: ${group.x + 40}, y: ${group.y + group.height / 2} })
          .then(() => new Promise((r) => setTimeout(r, 1200)))
          .then(() => { const h = ac.sidebarRows.useSidebarUi.getState().hover; return ac.shell.devSetPointer("w1", null).then(() => h && h.kind + ":" + h.id); });
      `);
      if (card !== `group:${below.group}`) throw new Error(`hovering the group showed ${card ?? "no card"}, not the group's`);
      return "the group's card";
    });
  }

  await rep.check("a live row under a still pointer gets its card back when its folder closes and opens again", async () => {
    const id = `live|${below.folder}|pr1`;
    const setFolder = (collapsed, ms) => ac(`ac.live.store.updateFolder("${below.folder}", { collapsed: ${collapsed} }); return new Promise((r) => setTimeout(r, ${ms}));`);
    const card = () => ac(`const h = ac.sidebarRows.useSidebarUi.getState().hover; return h && h.kind + ":" + h.id;`);
    await setFolder(false, 600);
    const row = await ac(`return ac.sidebarRows.measureRow("w1", "${id}");`);
    if (!row) throw new Error("the live row isn't in the sidebar");
    await ac(`return ac.shell.devSetPointer("w1", { x: ${row.x + 40}, y: ${row.y + row.height / 2} }).then(() => new Promise((r) => setTimeout(r, 1200)));`);
    const open = await card();
    await setFolder(true, 900);
    const closed = await card();
    await setFolder(false, 900);
    const reopened = await card();
    await ac(`return ac.shell.devSetPointer("w1", null);`);
    if (open !== `live:${id}`) throw new Error(`hovering the open row showed ${open ?? "no card"}`);
    if (closed === `live:${id}`) throw new Error("the row's card stayed up after its folder closed");
    if (reopened !== `live:${id}`) throw new Error(`after the folder opened again the card was ${reopened ?? "gone"}, not the row's`);
    return `open ${open}, closed ${closed ?? "none"}, reopened ${reopened}`;
  });
} catch (error) {
  rep.record("setup", { error });
} finally {
  await app?.quit();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);
