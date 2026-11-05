const CTRL = 262144;

export default {
  session: "session-0244n7-strip.json",
  minWidth: 700,
  setup: `return sleep(2500).then(() => done({ layout: st().settings.tabLayout, tabs: st().windows[W].tabIds.length }));`,
  act: `const next = (id) => key("⌃Tab", ${CTRL}, "\\t", 48).then(() => sleep(300)).then(() => st().windows[W].activeTabIds.default === id ? null : st().activate(id));
return at(420, 300).then(() => sleep(900))
  .then(() => move(560, 220, 600)).then(() => sleep(400))
  .then(() => { mark("go"); return next("t6"); }).then(() => sleep(1500))
  .then(() => next("t7")).then(() => sleep(2000))
  .then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  tail: 400,
};
