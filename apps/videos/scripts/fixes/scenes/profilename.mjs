import { play, Script } from "../input.mjs";

const PERSONAL_ROW = [420, 440];
const NAME_FIELD = [640, 234];
const AWAY = [520, 160];
const PROFILES_NAV = [72, 134];

export default {
  session: "session-0244n3-profiles.json",
  minWidth: 800,
  setup: `ac.openSettings("profiles", null); return sleep(2500).then(() => done({ name: st().profiles.default.name }));`,
  external: async (instance) => {
    const s = new Script();
    s.move(560, 580).wait(600).move(...PERSONAL_ROW, 800).wait(250).click().wait(1100);
    s.move(...NAME_FIELD, 700).wait(250).mark("go").click().wait(450);
    s.mark("⌘A").action("selectAll:").wait(500).text("Home", 160).wait(700);
    s.move(...AWAY, 600).wait(200).click().wait(1700);
    s.move(...PROFILES_NAV, 800).wait(250).click().wait(2600);
    return play(instance, s);
  },
  act: `return sleep(12500).then(() => done({ name: st().profiles.default.name }));`,
  tail: 400,
};
