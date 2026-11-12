import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const { useBrowser } = await import("../browser/store.ts");
const { useProfileLook } = await import("./hooks.ts");
const { setSwitcherIcon } = await import("./actions.ts");

const S = () => useBrowser.getState();

const lookOf = (profile, appDark, settings) => ({ color: profile?.color, appDark, follows: settings.spacesFollowAppearance });

test("a profile's look ignores tab switches, new tabs and profile switches, and follows appearance, its colour and the spaces setting", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const work = S().createProfile({ name: "Work", color: "blue" });
  const b = S().newTab(w, { url: "https://b.com/", background: true });
  const h = mount(() => useProfileLook(work, lookOf));
  const first = h.value;
  assert.equal(first.color, "blue");
  const renders = h.renders;

  S().activate(b);
  S().newTab(w, { url: "https://c.com/" });
  S().switchProfile(w, work);
  assert.equal(h.pending, false);
  assert.equal(h.renders, renders);
  assert.equal(h.value, first);

  S().setAppDark(!first.appDark);
  assert.equal(h.value.appDark, !first.appDark);

  S().updateProfile(work, { color: "green" });
  assert.equal(h.value.color, "green");

  S().updateSettings({ spacesFollowAppearance: !first.follows });
  assert.equal(h.value.follows, !first.follows);

  const settled = h.value;
  S().activate(b);
  assert.equal(h.value, settled);
  h.unmount();
});

const profile = (id, name, icon) => ({ id, name, color: "plum", icon, createdAt: 0 });

test("picking an icon from the switcher turns icons on, and clearing one leaves the setting alone", () => {
  S().hydrate({ profiles: { work: profile("work", "Work", null), home: profile("home", "Home", null) }, profileOrder: ["work", "home"] });
  S().updateSettings({ profileSwitcherIcons: false });
  setSwitcherIcon("work", null);
  assert.equal(S().settings.profileSwitcherIcons, false);
  setSwitcherIcon("work", "symbol:briefcase.fill");
  assert.equal(S().profiles.work.icon, "symbol:briefcase.fill");
  assert.equal(S().settings.profileSwitcherIcons, true);
  setSwitcherIcon("work", null);
  assert.equal(S().profiles.work.icon, null);
  assert.equal(S().settings.profileSwitcherIcons, true);
});
