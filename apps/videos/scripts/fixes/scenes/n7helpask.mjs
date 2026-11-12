export default {
  session: "session-0246n7-newtab.json",
  setup: `return sleep(1500).then(() => done());`,
  files: { "telemetry.json": {} },
  act: `return at(900, 600).then(() => sleep(800))
  .then(() => key("⌘T", CMD, "t", 17)).then(() => { mark("go"); return sleep(2600); })
  .then(() => typeText("trip", 160)).then(() => sleep(2600))
  .then(() => done({ tabs: Object.keys(st().tabs).length }));`,
  tail: 400,
};
