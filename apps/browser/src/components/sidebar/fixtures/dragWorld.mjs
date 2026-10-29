import { S, sceneLayout } from "./dragScene.mjs";
import { useBrowser } from "../../../state/browser/store.ts";
import { useLive } from "../../../state/live/store.ts";
import { useFolderPanel } from "../../../state/sidebar/tileFolderUi.ts";
import { useTabDrag } from "../../../state/drag/tabDrag.ts";

export function world(...hosts) {
  S().hydrate({});
  useLive.setState({ folders: {}, folderOrder: [], status: {} });
  useFolderPanel.setState({ open: null });
  useTabDrag.setState({ phase: "idle" }, true);
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  useBrowser.setState((s) => ({ windows: { ...s.windows, [w]: { ...s.windows[w], frame: [100, 100, 1200, 900] } } }));
  const id = { [hosts[0]]: S().windows[w].tabIds[0] };
  for (const h of hosts.slice(1)) id[h] = S().newTab(w, { url: `https://${h}.com/`, background: true });
  const host = (tabId) => (tabId ? new URL(S().tabs[tabId].url).hostname.split(".")[0] : tabId);
  return { w, id, host };
}

export function named(drop, host) {
  return JSON.parse(JSON.stringify(drop, (k, v) => (typeof v === "string" && /^tab-/.test(v) ? host(v) : v)));
}

export function regionsOf(L, marks) {
  return Object.fromEntries(Object.entries(marks).map(([name, [from, to]]) => [name, { x: 6, y: from, w: 180, h: to - from }]));
}

export function mixedScene({ collapsedH = false, pinnedGroupCollapsed = false } = {}) {
  const W = world("a", "b", "c", "g1", "h1", "g2", "s1", "s2", "p1", "p2", "pg1");
  const { id } = W;
  S().pinTabs([id.p1, id.p2], true, true);
  const PG = S().groupTabs([id.pg1], { pinned: true, name: "PG" });
  const G = S().groupTabs([id.g1, id.h1, id.g2], { pinned: false, name: "G" });
  const H = S().groupTabs([id.h1], { name: "H" });
  const SP = S().createSplit([id.s1, id.s2]);
  const L = sceneLayout({ top: 150 });
  L.row(id.p1, { section: "pinnedRows" }).row(id.p2, { section: "pinnedRows" });
  const pinnedTop = L.y;
  L.group(PG, { section: "pinnedGroups", collapsed: pinnedGroupCollapsed }, (m) => L.row(id.pg1, m));
  L.tail("pinnedGroups");
  L.skip(10);
  const listTop = L.y;
  L.row(id.a);
  L.group(G, {}, (m) => {
    L.row(id.g1, m);
    L.group(H, { parent: G, depth: 1, collapsed: collapsedH }, (n) => L.row(id.h1, n));
    L.row(id.g2, m);
  });
  L.row(id.b);
  L.split(SP, [id.s1, id.s2]);
  L.row(id.c);
  L.tail("list");
  const regions = regionsOf(L, { pinnedGroups: [pinnedTop, listTop], list: [listTop, L.y] });
  return { ...W, G, H, PG, SP, L, regions };
}
