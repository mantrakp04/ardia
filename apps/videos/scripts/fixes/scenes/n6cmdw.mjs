export default {
  session: "session-0246n6-tabs.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const PAD0 = Date.now();
const open = () => st().windows[W].tabIds.length;
const before = open();
return at(760, 520).then(() => sleep(500))
  .then(() => move(150, 159, 700)).then(() => sleep(250)).then(() => click()).then(() => sleep(700))
  .then(() => move(150, 233, 600)).then(() => sleep(250)).then(() => withKeys(SHIFT, "⇧-click", () => click())).then(() => sleep(1100))
  .then(() => move(760, 520, 600)).then(() => sleep(300))
  .then(() => { mark("go"); return key("⌘W", CMD, "w", 13); }).then(() => sleep(2400))
  .then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now())))
  .then(() => done({ before, after: open() }));`,
  tail: 400,
};
