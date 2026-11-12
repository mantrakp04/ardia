export default {
  session: "session-0246n7-small.json",
  minWidth: 700,
  setup: `ac.onboarding.redoOnboarding(); return sleep(2500).then(() => done({ step: ac.onboarding.useOnboarding.getState().step }));`,
  act: `const step = (name) => { mark(name); ac.onboarding.goToStep(name); };
return sleep(600).then(() => { mark("go"); return sleep(2600); })
  .then(() => { step("look"); return sleep(3200); })
  .then(() => { step("outro"); return sleep(3600); })
  .then(() => done({ step: ac.onboarding.useOnboarding.getState().step }));`,
  tail: 300,
};
