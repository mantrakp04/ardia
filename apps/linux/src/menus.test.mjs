import assert from "node:assert/strict";
import test from "node:test";
import { heldModifiers } from "./clickModifiers.ts";
import { alternateShown, menuButtonPresses, menuShown, showMenu } from "./menus.tsx";
import { notingPageFocus } from "./pageFocus.ts";

const pageTakesFocus = () => notingPageFocus({}).onPageFocus();

test("a page taking focus closes an open menu with no choice, and stops listening once it is closed", async () => {
  const items = [{ id: "copy", title: "Copy Link" }];
  const first = showMenu(items, { x: 10, y: 10 });
  assert.equal(menuShown(), true);
  pageTakesFocus();
  assert.equal(await first, null);
  assert.equal(menuShown(), false);
  const second = showMenu(items, { x: 10, y: 10 });
  const replaced = showMenu(items, { x: 20, y: 20 });
  assert.equal(await second, null);
  assert.equal(menuShown(), true);
  pageTakesFocus();
  assert.equal(await replaced, null);
  assert.equal(menuShown(), false);
  pageTakesFocus();
  assert.equal(menuShown(), false);
});

test("an alternate menu item shows while Alt, Linux's Option, is held, and a Command alternate while Ctrl is", () => {
  const keys = (e) => heldModifiers({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...e });
  const copy = { id: "copy", title: "Copy 3 Links", modifiers: [] };
  const markdown = { id: "copyMd", title: "Copy 3 Links as Markdown", modifiers: ["option"], alternate: true };
  assert.equal(alternateShown(copy, markdown, keys({})), false);
  assert.equal(alternateShown(copy, markdown, keys({ altKey: true })), true);
  assert.equal(alternateShown(copy, markdown, keys({ ctrlKey: true })), false);
  const keyed = { id: "copy", title: "Copy Link", key: "c", modifiers: ["command", "shift"] };
  const keyedMarkdown = { id: "copyMd", title: "Copy Link as Markdown", key: "c", modifiers: ["command", "shift", "option"], alternate: true };
  assert.equal(alternateShown(keyed, keyedMarkdown, keys({ altKey: true })), true);
  assert.equal(alternateShown(keyed, keyedMarkdown, keys({ ctrlKey: true, shiftKey: true })), false);
  const profile = { id: "work", title: "Work", key: "2", modifiers: ["control"] };
  const profileWindow = { id: "workWindow", title: "Work ↗", modifiers: ["command"], alternate: true };
  assert.equal(alternateShown(profile, profileWindow, keys({ ctrlKey: true })), true);
  assert.equal(alternateShown(profile, profileWindow, keys({ altKey: true })), false);
});

test("the app menu button toggles its menu from the keyboard as it does from the pointer", async () => {
  const items = [{ id: "copy", title: "Copy Link" }];
  let opened = 0;
  const presses = menuButtonPresses(() => { opened++; void showMenu(items, { x: 0, y: 0 }); });
  presses.click();
  assert.equal(opened, 1);
  assert.equal(menuShown(), true);
  presses.click();
  assert.equal(opened, 1, "Enter or Space on the button closes the open menu instead of opening it again");
  assert.equal(menuShown(), false);
  presses.click();
  assert.equal(opened, 2);
  presses.pointerDown();
  pageTakesFocus();
  presses.click();
  assert.equal(opened, 2, "a click whose press closed the menu doesn't reopen it");
  assert.equal(menuShown(), false);
  presses.pointerDown();
  presses.click();
  assert.equal(opened, 3);
  pageTakesFocus();
});
