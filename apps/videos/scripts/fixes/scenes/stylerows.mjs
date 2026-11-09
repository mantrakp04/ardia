export default {
  session: "session-0243n9-arc.json",
  setup: `return sleep(2000).then(() => { ac.openSettings("appearance"); return sleep(2500); }).then(() => done());`,
  act: `let gx = null;
let gy = null;
const glide = (x, y, ms) => {
  const x0 = gx ?? x;
  const y0 = gy ?? y;
  const steps = Math.max(1, Math.round(ms / 16));
  const step = (i) => {
    if (i > steps) return Promise.resolve();
    const k = ease(i / steps);
    gx = Math.round((x0 + (x - x0) * k) * 10) / 10;
    gy = Math.round((y0 + (y - y0) * k) * 10) / 10;
    events.push({ t: Date.now(), x: gx, y: gy });
    return sleep(16).then(() => step(i + 1));
  };
  return step(1);
};
return glide(560, 600, 16).then(() => sleep(900))
  .then(() => { mark("go"); return glide(632, 394, 700); }).then(() => sleep(1300))
  .then(() => glide(912, 394, 600)).then(() => sleep(1300))
  .then(() => glide(1013, 497, 600)).then(() => sleep(1400))
  .then(() => glide(1012, 556, 500)).then(() => sleep(2200))
  .then(() => done({ settings: Object.keys(st().settings).filter((k) => /^glass|interfaceStyle/.test(k)).map((k) => k + "=" + st().settings[k]) }));`,
  tail: 400,
};
