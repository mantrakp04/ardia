export default {
  session: "session-0246n6-right.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const PAD0 = Date.now();
return at(700, 520).then(() => sleep(600))
  .then(() => move(1125, 63, 900)).then(() => sleep(400))
  .then(() => { mark("go"); return click(); }).then(() => sleep(2800))
  .then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now())))
  .then(() => done({ popover: ac.pageState?.getState?.().popover ?? null }));`,
  tail: 400,
};
