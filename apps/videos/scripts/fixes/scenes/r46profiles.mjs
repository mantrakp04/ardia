export default {
  session: "session-r46-profiles.json",
  setup: `return sleep(2500).then(() => done({ profile: st().windows[W].profileId }));`,
  act: `const RIGHT = String.fromCharCode(0xf703), LEFT = String.fromCharCode(0xf702);
return at(760, 420).then(() => sleep(800))
  .then(() => { mark("go"); return key("⌥⌘→", CMD | OPT, RIGHT, 124); }).then(() => sleep(2000))
  .then(() => key("⌥⌘←", CMD | OPT, LEFT, 123)).then(() => sleep(2000))
  .then(() => done({ profile: st().windows[W].profileId }));`,
  tail: 400,
};
