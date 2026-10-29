import assert from "node:assert/strict";
import { test } from "node:test";
import { HostPageEvents } from "./hostPageEvents.ts";
import { applyHostPageTheme, resetHostPage } from "./hostPageLifecycle.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { pageOf, patchPage, popoverOf, setPopover } from "../../browser/src/state/tabs/pageState.ts";
import { updateLive, updateTab } from "../../browser/src/state/tabs/actions.ts";
import { noteScroll, useToolbarAutoHide } from "../../browser/src/state/windows/toolbarAutoHide.ts";

const lease = { claim: "claim", rendererGeneration: "2", bindingGeneration: "3", documentEpoch: "1" };
const security = { level: "secure", url: "https://example.test", origin: "https://example.test", certificate: { subject: { commonName: "old" } } };
const navigation = { url: "https://example.test", committedUrl: "https://example.test", title: "Example", canGoBack: true, canGoForward: false, isLoading: false, themeColor: null, themeColorSource: null };
const event = (name, data) => ({ name, data });
const message = (sequence, name, data, overrides = {}) => ({ ...lease, type: "pageEvent", sequence, event: event(name, data), ...overrides });
const control = (sequence, documentEpoch = "2", extra = {}) => ({ ...lease, type: "pageLifecycle", sequence, documentEpoch, action: "reset", reason: "document", ...extra });
const snapshot = (watermark = 1, events = [], metadata = {}) => ({ lease: { ...lease, ...metadata }, snapshot: { watermark, events } });

function setup() {
  useBrowser.getState().hydrate({});
  const window = useBrowser.getState().createWindow({ url: navigation.url });
  const tab = useBrowser.getState().windows[window].tabIds[0];
  const calls = [];
  const props = {
    onSecurity: (value) => { calls.push(["security", value]); patchPage(tab, { security: value }); },
    onNavigationChange: (value) => {
      calls.push(["navigation", value]);
      updateTab(tab, { url: value.url, title: value.title }, value);
      patchPage(tab, { themeColorSource: value.themeColorSource });
    },
    onZoom: (value) => { calls.push(["zoom", value]); updateTab(tab, { zoom: value.zoom }); },
    onFullscreen: (value) => { assert.equal(typeof value, "boolean"); patchPage(tab, { fullscreen: value }); },
    onStatus: (value) => { assert.equal(typeof value, "string"); patchPage(tab, { status: value }); },
    onCrashed: (value) => patchPage(tab, { crashed: value }),
    onUnresponsive: () => patchPage(tab, { unresponsive: true }),
    onResponsive: () => patchPage(tab, { unresponsive: false }),
    onPopupBlocked: (value) => patchPage(tab, { popups: [...pageOf(tab).popups, value] }),
    onFindResult: (...args) => calls.push(["find", ...args]),
    onPageFocus: (...args) => calls.push(["focus", ...args]),
    onScroll: (...args) => calls.push(["scroll", ...args]),
    onSelection: (...args) => calls.push(["selection", ...args]),
    onFavicon: (...args) => calls.push(["favicon", ...args]),
  };
  const receiver = new HostPageEvents("claim", () => 7, () => props, (reason, replaced) => { calls.push(["reset", reason]); resetHostPage(tab, reason, replaced); }, (state)=>applyHostPageTheme(tab,state));
  const send = (value, id = "7", module = "ArdiaWebView") => receiver.receive(module, id, value);
  return { tab, calls, receiver, send, props };
}

test("uses actual package dispatcher with exact find/focus and scalar/two-argument callbacks", () => {
  const h = setup();
  assert.ok(h.receiver.install(snapshot()));
  h.send(message(2, "find", { count: 4, active: 2, final: true }));
  h.send(message(3, "focus", {}));
  h.send(message(4, "fullscreen", { fullscreen: true }));
  h.send(message(5, "status", { text: "https://target.test" }));
  h.send(message(6, "pageMessage", { kind: "scroll", data: { state: "down" } }));
  h.send(message(7, "favicon", { url: "icon", urls: ["icon", "other"] }));
  const selected = { text: "word", rect: { x: 1, y: 2, width: 3, height: 4 } };
  h.send(message(8, "pageMessage", { kind: "selection", data: selected }));
  h.send(message(9, "pageMessage", { kind: "selection", data: null }));
  h.send(message(10, "pageMessage", { kind: "scroll", data: { state: "sideways" } }));
  h.send(message(11, "pageMessage", { kind: "unknown", data: {} }));
  assert.deepEqual(h.calls.slice(1), [["find", { count: 4, active: 2, final: true }], ["focus"], ["scroll", "down"], ["favicon", "icon", ["icon", "other"]], ["selection", selected], ["selection", null]]);
  assert.equal(pageOf(h.tab).fullscreen, true);
  assert.equal(pageOf(h.tab).status, "https://target.test");
});

test("maps both navigation URLs and preserves the public navigation schema", () => {
  const h = setup();
  h.receiver.install(snapshot());
  h.send(message(2, "navigation", { ...navigation, url: "chrome://settings", committedUrl: "chrome://history" }));
  assert.equal(h.calls.at(-1)[1].url, "ardia://settings");
  assert.equal(h.calls.at(-1)[1].committedUrl, "ardia://history");
  assert.equal(useBrowser.getState().tabs[h.tab].url, "ardia://settings");
});

test("authenticates the original claim, binding, shell generation and outer channel", () => {
  const h = setup(); h.receiver.install(snapshot());
  for (const override of [{ claim: "replacement" }, { rendererGeneration: "4" }, { bindingGeneration: "4" }, { rendererGeneration: 2 }, { bindingGeneration: "03" }, { documentEpoch: "18446744073709551616" }]) assert.equal(h.send(message(2, "security", security, override)), false);
  assert.equal(h.send(message(2, "security", security), "8"), false);
  assert.equal(h.send(message(2, "security", security), "7", "Other"), false);
  assert.equal(pageOf(h.tab).security, null);
  assert.equal(h.send(message(2, "security", security)), true);
  assert.deepEqual(pageOf(h.tab).security, security);
});

test("ordinary events cannot advance epoch or regress a later reset", () => {
  const h = setup(); h.receiver.install(snapshot());
  assert.equal(h.send(message(8, "security", security, { documentEpoch: "2" })), false);
  assert.equal(pageOf(h.tab).security, null);
  assert.equal(h.send(control(2)), true);
  assert.equal(h.send(message(100, "security", security)), false);
  assert.equal(h.send(message(3, "security", { ...security, certificate: undefined }, { documentEpoch: "2" })), true);
  assert.equal(h.send(control(101, "1")), false);
  assert.equal(h.send(control(4, "3", { reason: "provisional" })), false);
  assert.equal(h.send(message(4, "status", { text: "current" }, { documentEpoch: "2" })), true);
});

test("create snapshot watermark sorts bounded early controls and drops older or foreign events", () => {
  const h = setup();
  h.send(message(14, "security", { ...security, url: "https://new.test" }, { documentEpoch: "2" }));
  h.send(message(9, "security", security));
  h.send(control(12));
  h.send(message(15, "status", { text: "wrong channel" }), "8");
  h.send(message(16, "security", security, { bindingGeneration: "4" }));
  h.receiver.install(snapshot(10, [event("security", security)]));
  assert.equal(pageOf(h.tab).security.url, "https://new.test");
  assert.equal(pageOf(h.tab).status, "");
  assert.deepEqual(h.calls.map((c) => c[0]), ["reset", "security", "reset", "security"]);
  assert.equal(h.receiver.install(snapshot(20)), false);
});

test("same-URL document reset clears canonical security/theme/popup/status/crash/hung before new navigation", () => {
  const h = setup(); h.receiver.install(snapshot(1, [event("security", security)]));
  patchPage(h.tab, { crashed: { status: 1, code: 4, reason: "crashed" }, unresponsive: true, popups: [{ id: "old", url: "x", origin: "x" }], status: "old", themeColorSource: "meta" });
  updateLive(h.tab, { themeColor: "old" }); setPopover(h.tab, "popups"); noteScroll(h.tab, "down");
  h.props.onNavigationChange = (value) => {
    assert.equal(pageOf(h.tab).security, null); assert.equal(pageOf(h.tab).crashed, null);
    assert.equal(pageOf(h.tab).unresponsive, false); assert.equal(pageOf(h.tab).status, ""); assert.deepEqual(pageOf(h.tab).popups, []);
    assert.equal(pageOf(h.tab).themeColorSource, null); assert.equal(useBrowser.getState().live[h.tab].themeColor, null);
    assert.equal(popoverOf(h.tab), null); assert.equal(useToolbarAutoHide.getState().scrolledDown[h.tab], undefined);
    assert.equal(value.url, navigation.url);
  };
  h.send(control(2));h.send(message(3, "navigation", navigation, { documentEpoch: "2" }));
  h.send(message(4, "security", { ...security, certificate: undefined }, { documentEpoch: "2" }));
  assert.equal(pageOf(h.tab).security.certificate, undefined);
});

test("provisional clears presentation immediately and cancellation restores same-epoch authoritative snapshot once", () => {
  const h = setup(); h.receiver.install(snapshot(1, [event("security", security)]));
  h.send(control(2, "1", { reason: "provisional" })); assert.equal(pageOf(h.tab).security, null);
  const restore = control(3, "1", { action: "snapshot", events: [event("navigation", navigation), event("security", security), event("zoom", { zoom: 1.44, host: "example.test", isDefault: false, pinchScale: 2 }), event("fullscreen", { fullscreen: true })] });
  assert.equal(h.send(restore), true); assert.deepEqual(pageOf(h.tab).security, security);
  assert.equal(useBrowser.getState().tabs[h.tab].zoom, 1.44);assert.equal(pageOf(h.tab).fullscreen, true);
  const count=h.calls.length;assert.equal(h.send(restore), false);assert.equal(h.calls.length,count);
});

test("authoritative current snapshot may advance epoch and replaces popup state without duplicates", () => {
  const h=setup();const popup={id:"token",url:"https://popup.test",origin:"https://example.test"};
  h.receiver.install(snapshot(1,[event("popupBlocked",popup),event("popupBlocked",popup)])); assert.deepEqual(pageOf(h.tab).popups,[popup]);
  h.send(control(2,"4",{action:"snapshot",events:[event("popupBlocked",popup),event("popupBlocked",popup)]})); assert.deepEqual(pageOf(h.tab).popups,[popup]);
  assert.equal(h.send(message(9,"security",security,{documentEpoch:"3"})),false);
});

test("strict safe sequences reject zero, malformed, replayed, reordered and overflow values", () => {
  const h=setup();h.receiver.install(snapshot());
  for(const n of [0,-1,1.5,"2",NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.equal(h.send(message(n,"security",security)),false);
  assert.equal(h.send(message(3,"status",{text:"newer"})),true); assert.equal(h.send(message(2,"status",{text:"older"})),false);
  assert.equal(h.send(message(Number.MAX_SAFE_INTEGER,"status",{text:"last"})),true);
  assert.equal(h.send(control(Number.MAX_SAFE_INTEGER+1)),false);assert.equal(h.send(message(4,"security",security)),false);
});

test("early buffer overflow fails closed, snapshots are copied, disposal cancels reentrant replay", () => {
  const overflow=setup();for(let i=1;i<=128;i++) assert.equal(overflow.send(message(i,"focus",{})),true);
  assert.equal(overflow.send(message(129,"focus",{})),false);assert.equal(overflow.receiver.install(snapshot()),false);
  const h=setup();const early=message(3,"status",{text:"original"});h.send(early);early.event.data.text="mutated";
  h.receiver.install(snapshot());assert.equal(pageOf(h.tab).status,"original");
  h.props.onSecurity=()=>h.receiver.dispose();h.send(control(4,"2",{action:"snapshot",events:[event("security",security),event("status",{text:"stale"})]}));
  assert.equal(pageOf(h.tab).status,"");assert.equal(h.send(message(5,"status",{text:"late"},{documentEpoch:"2"})),false);
});

test("reentrant native delivery waits until the reset and whole snapshot have applied", () => {
  const h=setup();h.receiver.install(snapshot());
  h.props.onSecurity=(value)=>{patchPage(h.tab,{security:value});h.send(control(6,"3"));};
  h.send(control(3,"2",{action:"snapshot",events:[event("security",security),event("status",{text:"snapshot"})]}));
  assert.equal(pageOf(h.tab).security,null);assert.equal(pageOf(h.tab).status,"");
});

test("pending command guards capture original reset authority across provisional abort, document changes and disposal", () => {
  const h=setup();assert.equal(h.receiver.captureRequest(),null);h.receiver.install(snapshot());
  const before=h.receiver.captureRequest();assert.ok(before());h.send(message(2,"status",{text:"hover"}));assert.ok(before());
  h.send(control(3,"1",{reason:"provisional"}));assert.equal(before(),false);assert.equal(h.receiver.captureRequest(),null);
  assert.equal(h.send(message(4,"security",security)),false);assert.equal(pageOf(h.tab).security,null);
  h.send(control(5,"1",{action:"snapshot",events:[event("security",security)]}));const restored=h.receiver.captureRequest();assert.ok(restored());assert.equal(before(),false);
  h.send(control(6,"2"));assert.equal(restored(),false);const current=h.receiver.captureRequest();assert.ok(current());h.receiver.dispose();assert.equal(current(),false);
});

test("reentrant event chains are bounded and fail closed without recursive delivery", () => {
  const h=setup();h.receiver.install(snapshot());let sequence=2;
  h.props.onPageFocus=()=>h.send(message(++sequence,"focus",{}));
  h.send(message(sequence,"focus",{}));assert.equal(h.receiver.captureRequest(),null);
  assert.equal(h.send(message(++sequence,"status",{text:"late"})),false);
});

test("same-claim rebind installs a new binding snapshot and rejects buffered predecessor security", () => {
  const h=setup();h.receiver.install(snapshot(1,[event("security",security)]));const old=h.receiver.captureRequest();h.receiver.dispose();
  const next=new HostPageEvents("claim",()=>7,()=>h.props,(reason)=>resetHostPage(h.tab,reason),(state)=>applyHostPageTheme(h.tab,state));
  next.receive("ArdiaWebView","7",message(90,"security",security));
  next.receive("ArdiaWebView","7",message(3,"zoom",{zoom:1.25,host:"example.test",isDefault:false,pinchScale:1},{bindingGeneration:"4"}));
  assert.equal(next.install(snapshot(2,[event("security",{level:"none",url:navigation.url,origin:null})],{bindingGeneration:"4"})),true);
  assert.equal(old(),false);assert.equal(pageOf(h.tab).security.level,"none");assert.equal(pageOf(h.tab).security.certificate,undefined);
  assert.equal(useBrowser.getState().tabs[h.tab].zoom,1.25);
});

test("explicit native theme clear wins over shared same-URL launch-theme restoration", async () => {
  const {docs}=await import("../../browser/src/test-native/shell.ts");
  const {restoreLaunchLook,restoredThemeColor}=await import("../../browser/src/state/windows/launchLook.ts");
  const h=setup();
  docs.set("launch-look.json",JSON.stringify({version:2,themes:[{tab:h.tab,page:navigation.url,color:"saved"}],favicons:{images:[],profiles:{},themes:{}}}));
  restoreLaunchLook();assert.equal(restoredThemeColor(h.tab,navigation.url,null,true),"saved");
  h.props.onNavigationChange=(value)=>updateLive(h.tab,{themeColor:restoredThemeColor(h.tab,value.url,value.themeColor,value.isLoading)});
  h.receiver.install(snapshot(1,[event("navigation",{...navigation,isLoading:true})]));
  assert.equal(useBrowser.getState().live[h.tab].themeColor,null);
  h.send(control(2));h.send(message(3,"navigation",{...navigation,isLoading:true},{documentEpoch:"2"}));
  assert.equal(useBrowser.getState().live[h.tab].themeColor,null);assert.equal(pageOf(h.tab).themeColorSource,null);
  docs.delete("launch-look.json");
});

test("an aborted navigation keeps page state the restore snapshot does not replace", () => {
  const h = setup(); h.receiver.install(snapshot(1, [event("security", security)]));
  const popup = { id: "kept", url: "https://popup.test", origin: "https://example.test" };
  const prompt = { state: "save", origin: "https://example.test", username: "u", passwordLength: 3, federation: "", usernames: [] };
  patchPage(h.tab, { popups: [popup], status: "https://hover.test", fullscreen: true, passwordPrompt: prompt, unresponsive: true });
  setPopover(h.tab, "popups"); noteScroll(h.tab, "down");
  const kept = () => {
    assert.deepEqual(pageOf(h.tab).popups, [popup]); assert.equal(pageOf(h.tab).status, "https://hover.test");
    assert.equal(pageOf(h.tab).fullscreen, true); assert.deepEqual(pageOf(h.tab).passwordPrompt, prompt);
    assert.equal(pageOf(h.tab).unresponsive, true); assert.equal(popoverOf(h.tab), "popups");
    assert.equal(useToolbarAutoHide.getState().scrolledDown[h.tab] !== undefined, true);
  };
  h.send(control(2, "1", { reason: "provisional" }));
  assert.equal(pageOf(h.tab).security, null); kept();
  const themed = { ...navigation, themeColor: "#123456", themeColorSource: "meta" };
  h.send(control(3, "1", { action: "snapshot", reason: "restore", events: [event("navigation", themed), event("security", security), event("favicon", { url: "icon", urls: ["icon"] })] }));
  assert.deepEqual(pageOf(h.tab).security, security); kept();
  assert.equal(pageOf(h.tab).themeColorSource, "meta"); assert.equal(useBrowser.getState().live[h.tab].themeColor, "#123456");
  assert.deepEqual(h.calls.at(-1), ["favicon", "icon", ["icon"]]);
  const replacement = { id: "fresh", url: "https://other.test", origin: "https://example.test" };
  h.send(control(4, "1", { action: "snapshot", reason: "restore", events: [event("popupBlocked", replacement), event("status", { text: "" })] }));
  assert.deepEqual(pageOf(h.tab).popups, [replacement]); assert.equal(pageOf(h.tab).status, "");
  assert.equal(pageOf(h.tab).fullscreen, true); assert.deepEqual(pageOf(h.tab).security, security);
  h.send(control(5, "2"));
  assert.deepEqual(pageOf(h.tab).popups, []); assert.equal(pageOf(h.tab).fullscreen, false); assert.equal(pageOf(h.tab).passwordPrompt, null);
  assert.equal(popoverOf(h.tab), null); assert.equal(useToolbarAutoHide.getState().scrolledDown[h.tab], undefined);
});

test("snapshot reasons are validated", () => {
  const h = setup(); h.receiver.install(snapshot());
  assert.equal(h.send(control(2, "1", { action: "snapshot", reason: "other", events: [] })), false);
  assert.equal(h.send(control(2, "1", { action: "snapshot", reason: "restore", events: [] })), true);
  assert.equal(h.send(control(3, "1", { action: "snapshot", reason: "document", events: [] })), true);
});
