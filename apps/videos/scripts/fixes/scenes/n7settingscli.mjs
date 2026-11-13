import { play, Script } from "../input.mjs";

const SEARCH = [107, 66];

export default {
  session: "session-0246n7-small.json",
  minWidth: 800,
  setup: `ac.openSettings("general", null); return sleep(2500).then(() => done());`,
  external: async (instance) => {
    const s = new Script("Settings");
    s.move(420, 330).wait(700).move(...SEARCH, 800).wait(250).mark("go").click().wait(500);
    s.text("cli", 220).wait(3200);
    return play(instance, s);
  },
  act: `return sleep(7500).then(() => done());`,
  tail: 400,
};
