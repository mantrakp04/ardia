export default {
  session: "session-glass.json",
  setup: `return sleep(2500).then(() => done({ appearance: st().settings.appearance }));`,
  act: `return at(700, 520).then(() => sleep(400)).then(() => move(130, 171, 800)).then(() => { mark("go"); return sleep(1500); })
  .then(() => move(292, 176, 400)).then(() => move(311, 240, 350)).then(() => sleep(1300)).then(() => move(394, 240, 450)).then(() => sleep(800)).then(() => move(311, 240, 450)).then(() => sleep(1500))
  .then(() => done({ pinned: Object.values(st().tabs).filter((t) => t.pinned || t.pin).map((t) => t.id) }));`,
  tail: 300,
};
