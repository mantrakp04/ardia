export default {
  setup: `const ids = ["t4", "t5", "t3", "t6"]; return ids.reduce((p, id) => p.then(() => { st().activate(id); return sleep(1800); }), Promise.resolve()).then(() => done({ active: st().windows[W].activeTabIds }));`,
  act: `return at(700, 470).then(() => sleep(500)).then(() => { mark("go"); return key("⌘W", CMD, "w", 13); }).then(() => sleep(750)).then(() => key("⌘W", CMD, "w", 13)).then(() => sleep(1200)).then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  tail: 500,
  settle: 800,
};
