import { blankScene } from "./_blank.mjs";

export default blankScene(`() => key("⌘T", CMD, "t", 17).then(() => sleep(700)).then(() => [..."http://slow.example/timetable"].reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(45)), Promise.resolve())).then(() => sleep(400)).then(() => { mark("go"); return key("↩", 0, String.fromCharCode(13), 36); })`);
