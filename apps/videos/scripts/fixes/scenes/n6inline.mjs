export default {
  session: "session-0246n6-centred.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const PAD0 = Date.now();
const typeAll = (text) => text.split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(140)), Promise.resolve());
return at(760, 520).then(() => sleep(600))
  .then(() => move(520, 30, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1100))
  .then(() => typeAll("lexicon")).then(() => sleep(2200))
  .then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now())))
  .then(() => done());`,
  tail: 400,
};
