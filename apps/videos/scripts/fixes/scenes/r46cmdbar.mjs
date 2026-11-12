export default {
  session: "session-r46-cmdbar.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return at(760, 420).then(() => sleep(600))
  .then(() => { mark("go"); return key("⌘T", CMD, "t", 17); }).then(() => sleep(900))
  .then(() => typeText("trip", 160)).then(() => sleep(2600))
  .then(() => key("esc", 0, String.fromCharCode(27), 53)).then(() => sleep(600))
  .then(() => done());`,
  tail: 400,
};
