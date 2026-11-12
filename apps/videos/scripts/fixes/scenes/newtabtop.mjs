const PAGE = { x: 190, y: 47 };
export default {
  session: "session-long.json",
  setup: `st().updateSettings({ newTabPosition: "top", cmdClickCreatesTabGroup: false }); st().closeTabs(["t18", "t19", "t20", "t21", "t22", "t23", "t24", "t25"]); st().activate("t3"); return sleep(3000).then(() => done({ tabs: st().windows[W].tabIds.length }));`,
  prepare: async (instance) => {
    const page = await instance.page("Mount_Everest");
    await page.eval(`(() => { const s = document.createElement("style"); s.textContent = ".mwe-popups, .mwe-popups-container { display: none !important; }"; document.head.append(s); return 1; })()`);
    const r = await page.eval(`(() => [...document.querySelectorAll("#mw-content-text p a[href*='/wiki/']")].filter((a) => { const b = a.getBoundingClientRect(); return b.top > 330 && b.top < 700 && b.left > 100 && b.width > 40; }).slice(0, 2).map((a) => { const b = a.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: a.textContent }; }))()`);
    page.close();
    return r.map((l) => ({ ...l, x: Math.round(l.x + PAGE.x), y: Math.round(l.y + PAGE.y) }));
  },
  act: `return at(900, 300).then(() => sleep(300)).then(() => move(P[0].x, P[0].y, 700)).then(() => sleep(250)).then(() => withKeys(CMD, "⌘-click", () => click())).then(() => sleep(1100)).then(() => move(P[1].x, P[1].y, 500)).then(() => sleep(250)).then(() => { mark("go"); return withKeys(CMD, "⌘-click", () => click()); }).then(() => sleep(2600)).then(() => done({ tabs: st().windows[W].tabIds.length }));`,
};
