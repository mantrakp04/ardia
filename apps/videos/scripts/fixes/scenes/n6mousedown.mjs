export default {
  session: "session-0246n6-tabs.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const PAD0 = Date.now();
const active = () => st().windows[W].activeTabIds.default;
const seen = [];
return at(760, 520).then(() => sleep(700))
  .then(() => move(150, 196, 800)).then(() => sleep(400))
  .then(() => { mark("go"); events.push({ t: Date.now(), down: 1 }); return dw("mouse:down:150,196"); })
  .then(() => sleep(250)).then(() => { seen.push(active()); return sleep(1100); })
  .then(() => { events.push({ t: Date.now(), up: 1 }); return dw("mouse:up:150,196"); })
  .then(() => sleep(1600)).then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now()))).then(() => done({ duringPress: seen[0], after: active() }));`,
  tail: 400,
};
