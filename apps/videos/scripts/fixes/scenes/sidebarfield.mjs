export default {
  session: "session-0244n3-field.json",
  setup: `return sleep(1500).then(() => done({ addressBar: st().settings.addressBar, commandBar: st().settings.commandBarPlacement, active: st().windows[W].activeTabIds.default }));`,
  act: `return at(760, 640).then(() => sleep(700))
  .then(() => move(130, 63, 900)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1300))
  .then(() => typeText("maps", 150)).then(() => sleep(2600))
  .then(() => done({ tab: st().tabs.n1 && st().tabs.n1.url }));`,
  tail: 400,
};
