export default {
  setup: `st().activate("t3"); return sleep(3000).then(() => done());`,
  prepare: async (instance) => {
    const page = await instance.page("Mount_Everest");
    await page.eval(`(() => { const b = new Blob(["Everest base camp checklist\\n"], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "everest-checklist.txt"; document.body.append(a); a.click(); return 1; })()`, { userGesture: true });
    page.close();
    await new Promise((r) => setTimeout(r, 2500));
    await instance.eval(`const W = ac.store.getState().windowOrder[0]; ac.store.getState().setDownloadsOpen(W, false); return true;`);
    await new Promise((r) => setTimeout(r, 1200));
    return null;
  },
  act: `return at(620, 420).then(() => sleep(300)).then(() => move(166, 27, 800)).then(() => sleep(300)).then(() => { mark("go"); return click(); }).then(() => sleep(1200)).then(() => move(330, 260, 700)).then(() => sleep(2200)).then(() => done({ open: !!st().windowUi[W]?.downloadsOpen }));`,
};
