export default {
  setup: `return dw("fakeActiveClicks").then(() => { st().navigate("t3", "http://localhost:47231/save/"); st().activate("t3"); return sleep(3000); }).then(() => done({ url: st().tabs.t3.url }));`,
  act: `const S = () => dw("keys:" + CMD + ":s:1"); return at(900, 640).then(() => sleep(300)).then(() => move(560, 420, 700)).then(() => sleep(200)).then(() => click()).then(() => sleep(500)).then(() => move(700, 640, 500)).then(() => sleep(300)).then(() => { mark("go"); mark("⌘S"); return S(); }).then(() => sleep(2000)).then(() => { mark("⌘S ⌘S"); return S().then(() => sleep(140)).then(S); }).then(() => sleep(2400)).then(() => done({ sidebar: st().windows[W].sidebarOpen }));`,
};
