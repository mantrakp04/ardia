export default {
  setup: `return done();`,
  act: `hover = true; return at(600, 700).then(() => sleep(400)).then(() => move(95, 838, 900)).then(() => { mark("go"); return sleep(1600); }).then(() => move(107, 838, 300)).then(() => sleep(1600)).then(() => move(400, 700, 600)).then(() => ac.shell.devSetPointer(W, null)).then(() => sleep(500)).then(() => done());`,
};
