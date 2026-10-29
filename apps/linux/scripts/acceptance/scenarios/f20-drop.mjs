import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startBrowser } from "../lib/flows.mjs";
import { dispatchDrop, dropElements, sidebarDropPoint } from "../lib/ui.mjs";
import { nonce, until } from "../lib/util.mjs";

const tabUrls = (shell) => shell.state("return Object.values(s.tabs).filter(t => t.windowId === windowId).map(t => ({ id: t.id, url: t.url }));");

async function dropAndCollect(shell, point, data, { expect, settle = 2500 }) {
  const before = new Set((await tabUrls(shell)).map((t) => t.id));
  await dispatchDrop(shell, point, data);
  if (expect) {
    return until(async () => {
      const added = (await tabUrls(shell)).filter((t) => !before.has(t.id));
      return expect(added) ? added : false;
    }, { timeout: 10000, label: "tabs from the drop" });
  }
  await new Promise((resolve) => setTimeout(resolve, settle));
  return (await tabUrls(shell)).filter((t) => !before.has(t.id));
}

export default {
  id: "F20",
  issue: 30,
  title: "External drops into the sidebar and file drag out",
  deadline: 240000,
  manual: [
    { name: "Drag a downloaded file out to another application", steps: ["Download a file, open Ctrl+J.", "Drag its row into a scratch folder in the file manager (Wayland and X11).", "The file is copied there; the press alone does not open the file; releasing before the drag starts does nothing."], reason: "automated in F20D (sway) and F20X (X11) with a GTK drop target; a real file manager needs a person" },
    { name: "Drop real files from a file manager", steps: ["Drag one, then three files from the file manager onto the sidebar and onto the top strip.", "Each opens as a file:// tab in that position; dragging over and leaving shows and clears the drop indicator."], reason: "automated in F20D and F20X with a GTK drag source; a real file manager needs a person" },
    { name: "Internal reorder and page drops still work", steps: ["Drag a sidebar tab to a new position; it moves.", "Drag a tab onto the page area to make a split.", "Drag a link from a page onto a text field in another page; the page receives it."], reason: "automated in F20D; sidebar reorder and tab-to-page split fail there (#266)" },
  ],
  async run(t) {
    const run = nonce("f20");
    const { shell, scratch } = await startBrowser(t, { name: "drop" });
    const width = await shell.eval("innerWidth");
    let point;
    await t.check("the sidebar exposes a drop area", async () => {
      const areas = await dropElements(shell);
      point = sidebarDropPoint(areas, width);
      if (!point) throw new Error(`no sidebar drop area among ${JSON.stringify(areas)}`);
      return point;
    }, { critical: true });
    const one = t.fixtures.url.page(11, run);
    const two = t.fixtures.url.page(12, run);
    const three = t.fixtures.url.page(13, run);
    await t.check("dropping a URL opens it in a new tab", async () => {
      const added = await dropAndCollect(shell, point, { items: [{ mimeType: "text/uri-list", data: one }, { mimeType: "text/plain", data: one }] }, { expect: (tabs) => tabs.some((x) => x.url === one) });
      return added;
    });
    await t.check("dropping several URLs opens each", async () => {
      return dropAndCollect(shell, point, { items: [{ mimeType: "text/uri-list", data: `${two}\r\n${three}` }] }, { expect: (tabs) => [two, three].every((u) => tabs.some((x) => x.url === u)) });
    });
    await t.check("dropping address-like text opens it", async () => {
      const bare = t.fixtures.url.page(14, run).replace(/^http:\/\//, "");
      return dropAndCollect(shell, point, { items: [{ mimeType: "text/plain", data: bare }] }, { expect: (tabs) => tabs.some((x) => (x.url ?? "").includes(bare)) });
    });
    await t.check("dropping prose opens nothing", async () => {
      const added = await dropAndCollect(shell, point, { items: [{ mimeType: "text/plain", data: `ardia drop words ${run}` }] }, {});
      if (added.length) throw new Error(`prose opened ${JSON.stringify(added)}`);
      return { added: 0 };
    });
    await t.check("a page-supplied file drop cannot open a local path", async () => {
      const file = join(scratch, `dropped-${run}.txt`);
      await writeFile(file, "dropped");
      const added = await dropAndCollect(shell, point, { items: [], files: [file] }, {});
      const local = added.filter((x) => (x.url ?? "").startsWith("file:"));
      if (local.length) throw new Error(`a synthesized drop opened ${local.map((x) => x.url).join(", ")}`);
      return { added };
    });
    await t.check("a malformed drop opens nothing unsafe", async () => {
      const added = await dropAndCollect(shell, point, { items: [{ mimeType: "text/uri-list", data: "javascript:alert(1)\r\n#comment\r\n\u0000" }] }, {});
      const unsafe = added.filter((x) => /^(javascript|data|file):/i.test(x.url ?? ""));
      if (unsafe.length) throw new Error(`unsafe tabs ${JSON.stringify(unsafe)}`);
      return { added };
    });
    await t.screenshot(shell, "after-drops");
  },
};
