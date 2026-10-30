import assert from "node:assert/strict";
import test from "node:test";
import { reportMountLayout } from "./shims/web/mountLayout.ts";

function element({ left = 0, top = 0, width = 0, height = 0, parent = null, offsetParent = parent, connected = true, border = [0, 0], scroll = [0, 0] } = {}) {
  return {
    nodeType: 1,
    isConnected: connected,
    offsetLeft: left,
    offsetTop: top,
    offsetWidth: width,
    offsetHeight: height,
    clientLeft: border[0],
    clientTop: border[1],
    scrollLeft: scroll[0],
    scrollTop: scroll[1],
    parentNode: parent,
    offsetParent,
  };
}

const viewport = { scrollX: 0, scrollY: 0 };

test("a field mounted inside an opening command bar reports its layout during the commit, before any later key", () => {
  const panel = element({ left: 200, top: 120, width: 520, height: 107, border: [1, 1] });
  const row = element({ left: 12, top: 10, width: 496, height: 40, parent: panel });
  const field = element({ left: 36, top: 8, width: 440, height: 24, parent: row, offsetParent: row });
  const events = [];
  reportMountLayout(field, (event) => events.push(event), viewport);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].nativeEvent.layout, { x: 36, y: 8, width: 440, height: 24, left: 249, top: 139 });
  assert.equal(events[0].nativeEvent.target, field);
  assert.equal(typeof events[0].timeStamp, "number");
});

test("the mount layout matches react-native-web's measure, including page scroll", () => {
  const scroller = element({ left: 0, top: 0, width: 800, height: 600, scroll: [0, 50] });
  const field = element({ left: 20, top: 300, width: 200, height: 22, parent: scroller });
  const events = [];
  reportMountLayout(field, (event) => events.push(event), { scrollX: 0, scrollY: 10 });
  assert.deepEqual(events[0].nativeEvent.layout, { x: 20, y: 250, width: 200, height: 22, left: 20, top: 240 });
});

test("fields without a layout handler, detached fields and fields without a parent report nothing", () => {
  const events = [];
  const parent = element({ width: 100, height: 100 });
  assert.doesNotThrow(() => reportMountLayout(element({ parent }), undefined, viewport));
  reportMountLayout(element({ parent, connected: false }), (event) => events.push(event), viewport);
  reportMountLayout(element({ parent: null }), (event) => events.push(event), viewport);
  reportMountLayout(null, (event) => events.push(event), viewport);
  assert.equal(events.length, 0);
});
