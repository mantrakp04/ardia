const SPLIT_EDGE = [300, 33];

export default {
  session: "session-0244n7-split.json",
  setup: `st().activate("t1"); return sleep(1500).then(() => { st().openSplitPane(W, { tabId: "t2" }); return sleep(2500); }).then(() => { st().activate("t4"); return sleep(1500); }).then(() => done({ splits: Object.values(st().splits) }));`,
  act: `return at(700, 420).then(() => sleep(900))
  .then(() => move(${SPLIT_EDGE.join(", ")}, 800)).then(() => sleep(400))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1200))
  .then(() => click()).then(() => sleep(2000))
  .then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  tail: 400,
};
