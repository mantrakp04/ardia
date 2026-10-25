export default {
  setup: `st().activate("t3"); return sleep(3000).then(() => done());`,
  external: async (instance) => {
    await new Promise((r) => setTimeout(r, 300));
    const page = await instance.page("Mount_Everest");
    await page.eval(`(window.__share = navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(() => "shared", (e) => String(e)), 1)`, { userGesture: true });
    page.close();
  },
  act: `return at(1000, 640).then(() => sleep(900)).then(() => move(673, 157, 700)).then(() => sleep(200)).then(() => click()).then(() => sleep(1300)).then(() => move(657, 280, 600)).then(() => sleep(200)).then(() => { mark("go"); return click(); }).then(() => sleep(600)).then(() => move(610, 500, 700)).then(() => sleep(2200)).then(() => done());`,
};
