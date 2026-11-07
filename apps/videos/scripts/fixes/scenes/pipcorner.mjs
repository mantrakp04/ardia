const START = [588, 380, 336, 189];
const SCREEN_H = 982;
const WINDOW_TOP = 33;
const FLICK = [400, 300];

async function openPip(instance) {
  await new Promise((r) => setTimeout(r, 300));
  const page = await instance.page("watch.example");
  await page.eval(`document.getElementById("v").requestPictureInPicture().then(() => 1)`, { userGesture: true });
  page.close();
  await new Promise((r) => setTimeout(r, 1500));
  await instance.eval(`const st = () => ac.store.getState(); st().activate("t1"); const pip = (action) => ac.engine.call("tabs.devPictureInPictureAction", { action }); return pip("frame:{{${START[0]}, ${START[1]}}, {${START[2]}, ${START[3]}}}").then(() => pip("alpha:1")).then(() => new Promise((r) => setTimeout(r, 1500))).then(() => "ok");`);
  return null;
}

export default {
  session: "session-0244n7-pip.json",
  minWidth: 1400,
  switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  setup: `return sleep(3000).then(() => done());`,
  prepare: openPip,
  act: `const pip = (action) => ac.engine.call("tabs.devPictureInPictureAction", { action });
const pipInfo = () => ac.engine.call("tabs.devPictureInPicture").then((ws) => (ws || []).find((w) => w.video && w.visible));
const gx = ${START[0] + START[2] / 2};
const gy = ${SCREEN_H - (START[1] + START[3] * 0.3) - WINDOW_TOP};
const flick = (i, n) => i > n ? Promise.resolve() : (events.push({ t: Date.now(), x: gx + ${FLICK[0]} * i / n, y: gy + ${FLICK[1]} * i / n }), sleep(8).then(() => flick(i + 1, n)));
return at(700, 300).then(() => sleep(700))
  .then(() => move(gx, gy, 700)).then(() => sleep(350))
  .then(() => { mark("go"); events.push({ t: Date.now(), down: 1 }); return pip("drag:${FLICK[0]},${-FLICK[1]},6,8"); })
  .then(() => flick(1, 6)).then(() => events.push({ t: Date.now(), up: 1 }))
  .then(() => sleep(400)).then(() => move(gx + 200, gy + 120, 500)).then(() => hide())
  .then(() => sleep(3000)).then(pipInfo)
  .then((w) => done({ pip: w && { frame: w.frame, cornerRadius: w.cornerRadius } }));`,
  tail: 400,
};
