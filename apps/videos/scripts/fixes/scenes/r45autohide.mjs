export default {
  session: "session-r45-basic.json",
  act: `return at(700, 420).then(() => sleep(900))
  .then(() => { mark("go"); return key("⌘S", CMD, "s", 1); }).then(() => sleep(1800))
  .then(() => key("⌘N", CMD, "n", 45)).then(() => sleep(3200))
  .then(() => done({ windows: st().windowOrder.map((id) => ({ id, open: st().windows[id].sidebarOpen })), setting: st().settings.autoHideTabs }));`,
  tail: 500,
};
