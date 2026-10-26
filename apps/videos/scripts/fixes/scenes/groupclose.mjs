export default {
  session: "session-long.json",
  setup: `const gid = st().groupTabs(["t8", "t9", "t10", "t11"], { pinned: true, name: "Recipes" }); st().activate("t24"); return sleep(1800).then(() => { st().activate("t9"); return sleep(2200); }).then(() => done({ gid, pinned: st().tabs.t9.pinned }));`,
  act: `return sleep(600).then(() => { mark("go"); return key("⌘W", CMD, "w", 13); }).then(() => sleep(2800)).then(() => done({ active: st().windows[W].activeTabIds.default }));`,
};
