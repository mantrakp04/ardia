export default {
  session: "session-0243n8.json",
  setup: `return sleep(1500).then(() => done());`,
  relaunch: `ac.shell.writeDocument("onboarding.json", JSON.stringify({ completedAt: null, startedAt: Date.now(), step: "look", sub: 2, source: null, preset: "dia", picked: {}, version: 1 })); return done();`,
  act: `const style = () => st().settings.interfaceStyle || "none";
const note = (name) => events.push({ t: Date.now(), state: name + ":" + style() });
return at(700, 720).then(() => sleep(900))
  .then(() => move(362, 662, 700)).then(() => sleep(250))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1400))
  .then(() => move(470, 403, 700)).then(() => sleep(1900))
  .then(() => { mark("pick"); return click(); }).then(() => sleep(1700)).then(() => note("classic"))
  .then(() => move(470, 339, 500)).then(() => sleep(1200))
  .then(() => { mark("pick2"); return click(); }).then(() => sleep(1600)).then(() => note("glass"))
  .then(() => done());`,
  tail: 400,
};
