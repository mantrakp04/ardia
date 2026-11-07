import { ctrlClick, dumpAppMenu, MENU_GEOMETRY, pickAppMenu } from "./_menu.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE = "repo:github:ava/dotfiles";

const SEED = `const L = ac.live.store;
const pid = st().windows[W].profileId;
if (L.setAccount) L.setAccount("github", { login: "ava", name: null, avatar: null, connectedAt: Date.now() });
const f = L.createFolder(pid, "pullRequests");
const pr = (n, repo, title, section) => ({ id: "gh:" + repo + "#" + n, source: "github", url: "http://docpad.example/pr/" + n, title, subtitle: repo + " #" + n, icon: null, updatedAt: Date.now() - n * 60000, section: section || "authored",
  pr: { number: n, repo, author: "ava", authorAvatar: null, draft: false, headRef: "x", baseRef: "main", review: null, mergeable: "mergeable", checks: [{ name: "ci", state: "success", url: null }], comments: 0, unresolvedThreads: 0, additions: 12, deletions: 3, changedFiles: 2 } });
L.applyFetch(f, [
  pr(412, "acme/web", "Checkout: one-tap Apple Pay"),
  pr(407, "acme/api", "Rate limits per API key"),
  pr(17, "ava/dotfiles", "zsh: faster prompt"),
  pr(401, "acme/web", "Fix the cart badge on Safari"),
  pr(9, "ava/dotfiles", "nvim: switch to lazy.nvim"),
], {});
globalThis.__folder = f;`;

export default {
  session: "session-r44-basic.json",
  env: { ARDIA_TEST: "appMenu" },
  setup: `${SEED}
  return sleep(1800).then(() => done({ folder: globalThis.__folder, items: (ac.live.store.live ? ac.live.store.live().items[globalThis.__folder] || [] : []).length }));`,
  async prepare(instance, side) {
    const header = JSON.parse(await instance.eval(`const W = ac.store.getState().windowOrder[0]; return ac.sidebarRows.measureRow(W, "livefolder|" + globalThis.__folder).then((r) => JSON.stringify(r));`));
    const x = header ? Math.round(header.x + header.width * 0.45) : 120;
    const y = header ? Math.round(header.y + header.height / 2) : 200;
    const menu = await dumpAppMenu(instance, ctrlClick(x, y));
    pickAppMenu(instance, side === "after" ? HIDE : null);
    return { header, x, y, menu };
  },
  act: `${MENU_GEOMETRY}
  const choose = () => dw("mouse:down:" + P.x + "," + P.y + ",1," + 262144).then(() => dw("mouse:up:" + P.x + "," + P.y + ",1," + 262144));
  const menu = P.menu || [];
  const subIndex = menu.findIndex((i) => i.id === "repos");
  const g = geometry(menu, P.x, P.y, subIndex);
  const kids = subIndex >= 0 ? menu[subIndex].children || [] : [];
  const hideIndex = kids.findIndex((c) => c.id === ${JSON.stringify(HIDE)});
  return at(700, 470).then(() => sleep(500))
  .then(() => move(P.x, P.y, 800)).then(() => sleep(250))
  .then(() => { mark("go"); mark("⌃-click"); events.push({ t: Date.now(), down: 1 }); return sleep(90); })
  .then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "open", geometry: g, open: subIndex }); return sleep(900); })
  .then(() => subIndex < 0
    ? move(P.x + 70, rowCentre(menu, Math.min(menu.length - 1, 6), P.y), 900).then(() => sleep(1300))
    : move(P.x + 70, rowCentre(menu, subIndex, P.y), 900).then(() => { events.push({ t: Date.now(), menu: "sub" }); return sleep(500); })
      .then(() => move(g.subX + 30, rowCentre(menu, subIndex, P.y), 250)).then(() => move(g.subX + 60, rowCentre(kids, Math.max(0, hideIndex), g.subY), 600)).then(() => sleep(300)))
  .then(() => { events.push({ t: Date.now(), down: 1 }); return sleep(90); }).then(() => { events.push({ t: Date.now(), up: 1 }); events.push({ t: Date.now(), menu: "close" }); return choose(); }).then(() => sleep(300))
  .then(() => move(560, 520, 800)).then(() => sleep(3000))
  .then(() => done({ hidden: (ac.live.store.live ? (ac.live.store.live().folders[globalThis.__folder] || {}).hiddenRepos : null) }));`,
  tail: 500,
};
