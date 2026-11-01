import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";
import { useSettingsSheet } from "../../state/settings/sheet.ts";
import { useBrowser } from "../../state/browser/store.ts";

test("Escape cancels Profile creation while its name field is focused", async () => {
  const hook = registerHooks({ resolve(name, context, next) {
    if (name === "../ui" && context.parentURL?.endsWith("/settings/ProfileForm.tsx")) return { url: 'data:text/javascript,export const Box="Box",Button="Button",Sheet="Sheet",Text="Text",TextField="TextField";', shortCircuit: true };
    return next(name, context);
  } });
  let createProfileInSettings;
  try { ({ createProfileInSettings } = await import("./ProfileForm.tsx")); } finally { hook.deregister(); }
  useBrowser.getState().hydrate({});
  const before = Object.keys(useBrowser.getState().profiles);
  createProfileInSettings();
  const sheet = useSettingsSheet.getState().sheet;
  const row = mount(() => sheet.type(sheet.props));
  const children = (element) => [element, ...[element?.props?.children].flat().flatMap((child) => child && typeof child === "object" ? children(child) : [])];
  const field = children(row.value).find((node) => node?.props?.placeholder === "Profile name");
  assert.equal(typeof field.props.onEscape, "function");
  field.props.onEscape();
  assert.equal(useSettingsSheet.getState().sheet, null);
  assert.deepEqual(Object.keys(useBrowser.getState().profiles), before);
  row.unmount();
});
