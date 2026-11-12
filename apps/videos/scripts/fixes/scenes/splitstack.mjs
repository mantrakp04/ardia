export default {
  session: "session-0246n2-split.json",
  setup: `const s = st();
const ids = (sp) => sp.slots.map((x) => ("stack" in x ? x.stack : x.tabId));
const split = s.createSplit(["t2", "t3"]);
s.activate("t3");
return sleep(1500).then(() => { st().openSplitPane(W, { tabId: "t4", anchorTabId: "t3", side: "bottom" }); return sleep(1500); })
  .then(() => { st().closeTab("t2"); return sleep(2000); })
  .then(() => done({ split, slots: ids(st().splits[split]) }));`,
  act: `const ids = (sp) => sp.slots.map((x) => ("stack" in x ? x.stack : x.tabId));
return sleep(1400).then(() => { mark("go"); st().openSplitPane(W, { tabId: "t5", anchorTabId: "t3", side: "bottom" }); return sleep(3600); })
  .then(() => done({ splits: Object.values(st().splits).map((sp) => [ids(sp), sp.orientation]), tabs: st().windows[W].tabIds }));`,
  tail: 400,
};
