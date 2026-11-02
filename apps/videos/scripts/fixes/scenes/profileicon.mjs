import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { play, Script } from "../input.mjs";

const CHANGE = [726, 279];
const ROCKET_RESULT = [531, 352];
const ROCKET = "🚀";
const WINDOW_H = 640;
const MENU = { row: 22, separator: 11, pad: 5, width: 168, subWidth: 64, margin: 4 };
const MAIN_ROWS = { rows: 22, separators: 2 };
const SUB_ROWS = 20;
const ROCKET_INDEX = 15;

const mainHeight = MENU.pad * 2 + MAIN_ROWS.rows * MENU.row + MAIN_ROWS.separators * MENU.separator;
const subHeight = MENU.pad * 2 + SUB_ROWS * MENU.row;
const GEOMETRY = {
  ...MENU,
  x: 820 - MENU.margin - MENU.width,
  y: WINDOW_H - MENU.margin - mainHeight,
  subX: 820 - MENU.margin - MENU.width - MENU.subWidth,
  subY: WINDOW_H - MENU.margin - subHeight,
};
const EMOJI_ROW_Y = GEOMETRY.y + mainHeight - MENU.pad - MENU.row / 2;
const ROCKET_ROW = [GEOMETRY.subX + MENU.subWidth / 2, GEOMETRY.subY + MENU.pad + ROCKET_INDEX * MENU.row + MENU.row / 2];

function writePick(data) {
  const file = join(data, "menu.json");
  if (!existsSync(file)) return;
  const rocket = JSON.parse(readFileSync(file, "utf8")).at(-1)?.children?.find((c) => c.title === ROCKET);
  if (rocket) writeFileSync(join(data, "menu.json.pick"), rocket.id);
}

export default {
  session: "session-0244n3-profiles.json",
  minWidth: 800,
  env: { ARDIA_TEST: "appMenu" },
  setup: `ac.openSettings("profiles", "default"); return sleep(2500).then(() => done({ icon: st().profiles.default.icon }));`,
  external: async (instance, side) => {
    const s = new Script();
    s.move(560, 470).wait(700).move(...CHANGE, 900).wait(300).mark("go").click();
    let pickAt = null;
    if (side === "after") {
      s.wait(1000).text("rocket", 150).wait(900).move(...ROCKET_RESULT, 700).wait(300).click().wait(2600);
    } else {
      s.note({ menu: "open", geometry: GEOMETRY }).wait(700);
      s.move(GEOMETRY.x + 70, EMOJI_ROW_Y, 1100, { real: false }).wait(150).note({ submenu: "open" }).wait(550);
      s.move(GEOMETRY.x - 6, EMOJI_ROW_Y, 200, { real: false }).move(...ROCKET_ROW, 700, { real: false }).wait(300);
      pickAt = s.at;
      s.click({ real: false }).click({ x: CHANGE[0], y: CHANGE[1], draw: false }).note({ menu: "close" }).wait(2600);
    }
    return play(instance, s, { onStart: () => pickAt !== null && setTimeout(() => writePick(instance.data), pickAt - 400) });
  },
  act: `return sleep(8500).then(() => done({ icon: st().profiles.default.icon }));`,
  tail: 400,
};
