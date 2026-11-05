import { play, Script } from "../input.mjs";

const WORK_TOGGLE = [764, 433];
const SINGLE_SWITCH = [764, 315];

export default {
  session: "session-0244n7-profiles.json",
  minWidth: 700,
  setup: `ac.openSettings("profiles", null); return sleep(2500).then(() => done({ profiles: Object.values(st().profiles).map((p) => [p.id, p.dataId, p.ownTopApps]) }));`,
  external: async (instance, side) => {
    const s = new Script();
    s.move(520, 560).wait(700);
    if (side === "after") s.move(...WORK_TOGGLE, 900).wait(350).mark("go").click().wait(3200);
    else s.move(...SINGLE_SWITCH, 900).wait(350).mark("go").wait(3200);
    return play(instance, s);
  },
  act: `return sleep(6500).then(() => done({ own: Object.values(st().profiles).map((p) => [p.id, !!p.ownTopApps]) }));`,
  tail: 400,
};
