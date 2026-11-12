import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import {
  activeSteps,
  cancelOnboarding,
  chooseSource,
  confirmAnswer,
  customizeMore,
  finishOnboarding,
  onboardingCompletedAt,
  previewLive,
  redoOnboarding,
  resolveDraft,
  draftPreset,
  skipStep,
  sourcePatch,
  startOnboarding,
  useOnboarding,
} from "./onboarding.ts";

const S = () => useBrowser.getState();
const O = () => useOnboarding.getState();
const settle = () => useOnboarding.setState({ windowId: null, leaving: false, redo: false, customizing: false });

test("the default path is three steps, whatever browser you come from", () => {
  const id = S().createWindow();
  for (const source of [null, "fresh", "chrome", "safari", "arc", "dia"]) {
    startOnboarding(id, "source");
    chooseSource(source);
    assert.deepEqual(activeSteps().filter((s) => s !== "intro"), ["source", "look", "outro"], String(source));
  }
  settle();
});

test("Customize more adds the detailed steps after look and comes back to the last step", () => {
  const id = S().createWindow();
  startOnboarding(id, "source");
  chooseSource("arc");
  confirmAnswer("source", sourcePatch(), []);
  assert.equal(O().step, "look");
  confirmAnswer("look", {}, []);
  assert.equal(O().step, "outro");
  customizeMore();
  assert.equal(O().step, "layout");
  assert.deepEqual(activeSteps().filter((s) => s !== "intro"), ["source", "look", "layout", "tabs", "details", "searchPrivacy", "pins", "home", "outro"]);
  for (const step of ["layout", "tabs", "details", "searchPrivacy", "pins", "home"]) {
    assert.equal(O().step, step);
    skipStep();
  }
  assert.equal(O().step, "outro");
  settle();
});

test("redo starts from the current settings, keeps them unless a new browser is picked, and cancel undoes previews", () => {
  const id = S().createWindow();
  S().updateSettings({ appearance: "dark", searchEngine: "kagi", newTabOpens: "page", addressBar: "toolbar" });
  const completed = onboardingCompletedAt();
  assert.equal(redoOnboarding(id), id);
  assert.equal(O().step, "source");
  assert.equal(O().redo, true);
  const now = resolveDraft(["appearance", "searchEngine", "addressBar"], O().draft, draftPreset(O()), S().settings, []);
  assert.deepEqual(now, { appearance: "dark", searchEngine: "kagi", addressBar: "toolbar" });
  chooseSource(O().redoSource);
  assert.deepEqual(sourcePatch(), {});
  chooseSource(O().redoSource === "arc" ? "dia" : "arc");
  assert.ok(Object.keys(sourcePatch()).length > 0, "a different browser brings its preset");
  chooseSource(O().redoSource);
  previewLive({ appearance: "light" });
  assert.equal(S().settings.appearance, "light");
  cancelOnboarding();
  assert.equal(S().settings.appearance, "dark");
  assert.equal(S().settings.searchEngine, "kagi");
  assert.equal(onboardingCompletedAt(), completed, "redo never touches when onboarding was first finished");
  settle();
  assert.equal(redoOnboarding(id), id);
  finishOnboarding();
  assert.equal(onboardingCompletedAt(), completed);
  settle();
});
