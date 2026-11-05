import { play, Script } from "../input.mjs";

const ADVANCED = [719, 274];

export default {
  session: "session-r44-small.json",
  minWidth: 750,
  setup: `ac.openSettings("privacy"); return sleep(3000).then(() => done());`,
  external: async (instance) => {
    const s = new Script();
    s.move(420, 520).wait(600).move(175, 617, 800).wait(300).click().wait(1500).move(...ADVANCED, 900).wait(300).mark("go").click().wait(3500);
    return play(instance, s);
  },
  act: `return sleep(9000).then(() => done());`,
  tail: 400,
};
