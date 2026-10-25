import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

globalThis.__DEV__ = false;
const fixture = { saved: new Map() };
globalThis.onboardingNavigationFixture = fixture;
const shell = "data:text/javascript," + encodeURIComponent(`
export const launchEnvironment = () => null;
export const stopIntroMusic = () => {};
export const readDocument = name => globalThis.onboardingNavigationFixture.saved.get(name) ?? null;
export const writeDocument = (name, value) => globalThis.onboardingNavigationFixture.saved.set(name, value);
`);
const tour = "data:text/javascript," + encodeURIComponent(`
export const endToolTour = () => {};
export const startToolTour = () => {};
`);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === new URL("./state.ts", import.meta.url).href) {
      if (specifier === "@ardia/shell") return { url: shell, shortCircuit: true };
      if (specifier === "./tour/state") return { url: tour, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { useOnboarding, questionsFor, QUESTION_ORDER, maybeStartOnboarding } = await import("./state.ts");
const { useBrowser } = await import("../../store/browser.ts");

beforeEach(() => {
  fixture.saved.clear();
  useBrowser.getState().hydrate({});
  useBrowser.getState().createWindow();
  useOnboarding.setState({ step: "searchPrivacy", sub: 2, draft: {}, baseline: {}, picked: {}, leaving: false });
});

test("the last search question leads through protection to pins and back", () => {
  useOnboarding.getState().next();
  assert.equal(useOnboarding.getState().step, "blocker");
  assert.deepEqual(questionsFor("blocker").map(q => q.id), ["blocker"]);
  useOnboarding.getState().confirm("blocker", {}, ["Standard"]);
  assert.equal(useOnboarding.getState().step, "pins");
  assert.deepEqual(QUESTION_ORDER.flatMap(q => useOnboarding.getState().picked[q] ?? []), ["Standard"]);
  useOnboarding.getState().back();
  assert.equal(useOnboarding.getState().step, "blocker");
  assert.equal(useOnboarding.getState().sub, 0);
  useOnboarding.getState().back();
  assert.equal(useOnboarding.getState().step, "searchPrivacy");
  assert.equal(questionsFor("searchPrivacy")[useOnboarding.getState().sub].id, "crash");
});

test("skipping search questions still offers protection without recording consent", () => {
  useOnboarding.getState().go("searchPrivacy", 0);
  useOnboarding.getState().skip();
  assert.equal(useOnboarding.getState().step, "blocker");
  assert.equal(useOnboarding.getState().picked.blocker, undefined);
});

test("an interrupted setup resumes on the protection question", () => {
  fixture.saved.set("onboarding.json", JSON.stringify({ version: 1, startedAt: 1, completedAt: null, step: "blocker", sub: 0 }));
  maybeStartOnboarding();
  assert.equal(useOnboarding.getState().step, "blocker");
  assert.equal(useOnboarding.getState().sub, 0);
  assert.equal(useOnboarding.getState().picked.blocker, undefined);
  useOnboarding.getState().next();
  assert.equal(useOnboarding.getState().step, "pins");
});
