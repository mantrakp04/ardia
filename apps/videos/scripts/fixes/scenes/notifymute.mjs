const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUB = `const m = globalThis.expo.modules.ArdiaNotifications;
m.notificationPermission = () => Promise.resolve("granted");
m.requestNotificationPermission = () => Promise.resolve(true);
m.removeNotifications = () => Promise.resolve();
m.postNotification = (o) => { if (globalThis.__onPost) globalThis.__onPost(o); return Promise.resolve(o.id || null); };`;

const SEND_AT_MS = 3900;

export default {
  session: "session-0244n2-notify.json",
  switches: ["--unsafely-treat-insecure-origin-as-secure=http://chat.example"],
  setup: `${STUB}
st().activate("c1");
return sleep(3000).then(() => done({ muted: !!st().tabs.c1.muted }));`,
  prepare: async (instance) => {
    const page = await instance.page("chat.example");
    await page.eval("(Notification.requestPermission(), 1)", { awaitPromise: false });
    await sleep(1500);
    await instance.eval(`const r = ac.pageState.getState().pages.c1 && ac.pageState.getState().pages.c1.permission; if (r) ac.permissions.answerPermission("c1", r.id, "accept"); return 1;`);
    await sleep(1000);
    const permission = await page.eval("Notification.permission");
    await instance.eval(`ac.store.getState().activate("t1"); return 1;`);
    await sleep(1500);
    const { row } = JSON.parse(await instance.eval(`const W = ac.store.getState().windowOrder[0]; return ac.sidebarRows.measureRow(W, "c1").then((row) => JSON.stringify({ row }));`, { timeout: 20000 }));
    page.close();
    return { row, permission };
  },
  external: async (instance) => {
    const page = await instance.page("chat.example");
    await sleep(SEND_AT_MS);
    const t = Date.now();
    await page.eval('(document.dispatchEvent(new Event("pinecone:message")), 1)');
    page.close();
    return [{ t, mark: "go" }];
  },
  act: `const posts = [];
globalThis.__onPost = (o) => { posts.push({ title: o.title, silent: !!o.silent }); events.push({ t: Date.now(), notify: 1, title: o.title, body: o.body || "", subtitle: o.subtitle || "", silent: !!o.silent }); };
const rx = Math.round(P.row.x + P.row.width * 0.5), ry = Math.round(P.row.y + P.row.height / 2);
return at(760, 520).then(() => sleep(600))
  .then(() => move(rx, ry, 900)).then(() => sleep(1000))
  .then(() => move(560, 520, 800)).then(() => sleep(5200))
  .then(() => done({ posts, permission: P.permission, muted: !!st().tabs.c1.muted }));`,
  tail: 400,
};
