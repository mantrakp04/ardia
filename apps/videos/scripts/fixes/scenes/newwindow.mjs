export default {
  session: "session-0243n8-work.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return at(760, 470).then(() => sleep(1200))
  .then(() => { mark("go"); return key("⌘N", CMD, "n", 45); }).then(() => sleep(3400))
  .then(() => done({ windows: st().windowOrder.map((id) => ({ id, profile: st().windows[id].profileId, frame: st().windows[id].frame })) }));`,
  tail: 500,
};
