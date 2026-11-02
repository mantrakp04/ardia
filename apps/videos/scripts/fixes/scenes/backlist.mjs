export default {
  setup: `st().activate("t3"); return sleep(2000).then(() => done());`,
  relaunch: `const go = (url) => { st().navigate("t3", url); return sleep(2500); }; return go("http://moodwall.example/").then(() => go("http://docpad.example/")).then(() => go("http://crumbs.example/")).then(() => sleep(3500)).then(() => done({ url: st().tabs.t3.url }));`,
  act: `return at(700, 460).then(() => sleep(300)).then(() => move(245, 27, 800)).then(() => sleep(300)).then(() => { mark("go"); return click(); }).then(() => sleep(1600)).then(() => click()).then(() => sleep(1800)).then(() => move(560, 300, 600)).then(() => sleep(800)).then(() => done({ url: st().tabs.t3.url }));`,
};
