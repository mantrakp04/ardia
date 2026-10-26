export default {
  session: "session-dock.json",
  setup: `return sleep(1500).then(() => done());`,
  act: `return sleep(600).then(() => { mark("go"); return key("⌘S", CMD, "s", 1); }).then(() => sleep(2000)).then(() => key("⌘S", CMD, "s", 1)).then(() => sleep(2200)).then(() => done({ open: st().windows[W].sidebarOpen }));`,
};
