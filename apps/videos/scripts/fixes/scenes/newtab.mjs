export default {
  setup: `st().updateSettings({ newTabPosition: "nextToCurrent" }); st().activate("t4"); return sleep(500).then(() => done({ pos: st().settings.newTabPosition }));`,
  act: `return sleep(600).then(() => { mark("go"); return key("⌘T", CMD, "t", 17); }).then(() => sleep(2600)).then(() => done({ order: st().windows[W].tabIds }));`,
};
