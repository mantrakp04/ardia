const visits = ["r1", "r2", "r3", "t2", "t3", "p2", "t1"];
export default {
  session: "session-bar.json",
  setup: `const ids = ${JSON.stringify(visits)};
const visit = (i) => i >= ids.length ? Promise.resolve() : (st().activate(ids[i]), sleep(900)).then(() => visit(i + 1));
return sleep(1500).then(() => visit(0)).then(() => {
  st().addBookmarkTree("default", [
    { title: "Lexicon", url: "http://lexicon.example/" },
    { title: "Reading", children: [
      { title: "The Daily Ledger", url: "http://dailyledger.example/" },
      { title: "moodwall — ideas for everything", url: "http://moodwall.example/" },
      { title: "Crumbs — Brown butter oat cookies", url: "http://crumbs.example/" },
      { title: "Trip plan — Docpad", url: "http://docpad.example/" },
    ] },
    { title: "Trip plan", url: "http://docpad.example/" },
    { title: "Recipes", children: [{ title: "Crumbs — Brown butter oat cookies", url: "http://crumbs.example/" }] },
  ]);
  return sleep(1500);
}).then(() => done({ bar: Object.values(st().bookmarks.nodes).filter((n) => n.kind === "url").length }));`,
  settle: 3000,
  act: `return at(760, 520).then(() => sleep(400)).then(() => move(395, 64, 800)).then(() => sleep(700)).then(() => { mark("go"); return click(); }).then(() => sleep(1300)).then(() => move(470, 128, 700)).then(() => sleep(1500)).then(() => move(130, 620, 700)).then(() => sleep(300)).then(() => { events.push({ t: Date.now(), close: 1 }); return click(); }).then(() => sleep(1200)).then(() => { mark("Size: Large"); st().updateSettings({ bookmarksBarSize: "large" }); return sleep(2200); }).then(() => done({ size: st().settings.bookmarksBarSize }));`,
  tail: 300,
};
