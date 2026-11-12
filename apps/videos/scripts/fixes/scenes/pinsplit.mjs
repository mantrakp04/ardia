export default {
  setup: `st().activate("t1"); return sleep(1500).then(() => { st().openSplitPane(W, { tabId: "t2" }); return sleep(3000); }).then(() => done({ splits: Object.values(st().splits) }));`,
  act: `return sleep(600).then(() => { mark("go"); return key("⌘W", CMD, "w", 13); }).then(() => sleep(2600)).then(() => done({ splits: Object.values(st().splits), pins: Object.values(st().tabs).filter((t) => t.pinned).map((t) => t.id) }));`,
};
