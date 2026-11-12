const PAGE = { x: 190, y: 47 };
export default {
  setup: `return dw("fakeActiveClicks").then(() => { st().activate("t3"); return sleep(3000); }).then(() => done());`,
  prepare: async (instance) => {
    const page = await instance.page("Mount_Everest");
    const r = await page.eval(`(() => { const a = [...document.querySelectorAll("#mw-content-text p a[href*='/wiki/']")].find((a) => { const b = a.getBoundingClientRect(); return b.top > 300 && b.width > 30; }); const b = a.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: a.textContent, href: a.href }; })()`);
    page.close();
    return { ...r, x: Math.round(r.x + PAGE.x), y: Math.round(r.y + PAGE.y) };
  },
  act: `return at(980, 300).then(() => sleep(300)).then(() => move(P.x, P.y, 800)).then(() => sleep(300)).then(() => { mark("go"); return withKeys(OPT + SHIFT, "⌥⇧-click", () => click()); }).then(() => sleep(250)).then(() => move(1060, 24, 500)).then(() => sleep(2600)).then(() => done({ windows: st().windowOrder, splits: Object.values(st().splits).map((s) => s.tabIds) }));`,
};
