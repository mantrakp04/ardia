export const DEMO_WINDOW = { width: 1408, height: 868 };
export const VIEWPORT = { width: 1440, height: 900 };
export const WINDOW_INSET = { left: (VIEWPORT.width - DEMO_WINDOW.width) / 2, top: (VIEWPORT.height - DEMO_WINDOW.height) / 2 };
export const HOVER_ROW = { x: 100, y: 172 };
export const COMMAND_QUERY = "365*24";
export const STATES = ["idle", "command", "ntp", "hover", "menu", "profile", "field"];
export const THEMES = ["light", "dark"];

export function resetScript(store, seedTabs) {
  const ids = JSON.stringify(seedTabs.map((t) => t.id));
  const titles = JSON.stringify(Object.fromEntries(seedTabs.map((t) => [t.id, t.title])));
  return `
    const store = ${store};
    const s = store.getState();
    const windowId = Object.keys(s.windows)[0];
    if (s.windowUi[windowId]?.panel.open) s.closePanel(windowId);
    if (s.settings.addressBar !== "toolbar") s.updateSettings({ addressBar: "toolbar" });
    for (const id of store.getState().windows[windowId].tabIds) if (!${ids}.includes(id)) store.getState().closeTab(id);
    if (store.getState().windows[windowId].profileId !== "default") store.getState().switchProfile(windowId, "default");
    store.getState().activate("t_browser");
    for (const [id, title] of Object.entries(${titles})) if (store.getState().tabs[id]?.title !== title) store.getState().updateTab(id, { title });
    return windowId;
  `;
}

export const newTabScript = (store) => `const s = ${store}.getState(); s.newTab(Object.keys(s.windows)[0]); return true;`;
export const fieldScript = (store) => `${store}.getState().updateSettings({ addressBar: "sidebar" }); return true;`;
export const profileScript = (store) => `const s = ${store}.getState(); s.switchProfile(Object.keys(s.windows)[0], "p_work"); return true;`;

const GENERIC = [
  "View", "Text", "Pressable", "Image", "ScrollView", "TextInput", "FlatList", "VirtualizedList", "ActivityIndicator",
  "TouchableOpacity", "TouchableWithoutFeedback", "TouchableHighlight", "AnimatedComponent", "MacView", "MacPressable",
  "MacTextInput", "NativeViewPlaceholder", "ScrollViewBase", "CellRenderer", "VirtualizedListCellContextProvider",
];

const walker = (collect) => `
  const GENERIC = new Set(${JSON.stringify(GENERIC)});
  const nameOf = (f) => {
    const t = f.type;
    if (!t || typeof t === "string") return null;
    const raw = t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null;
    return raw ? raw.replace(/[0-9]+$/, "") : null;
  };
  const composites = [];
  const counts = new Map();
  const hosts = [];
  const visit = (fiber, owners) => {
    for (let f = fiber; f; f = f.sibling) {
      let mine = owners;
      const name = nameOf(f);
      if (name && f.tag !== 5 && !GENERIC.has(name) && !/^Animated\\(|Context|Provider|Consumer|^Memo\\(|^ForwardRef/.test(name)) {
        const n = (counts.get(name) ?? 0) + 1;
        counts.set(name, n);
        const entry = { key: name + "#" + n, hosts: [] };
        composites.push(entry);
        mine = [...owners, entry];
      }
      if (f.tag === 5 && f.stateNode) {
        const label = f.memoizedProps && f.memoizedProps.children;
        if (typeof label === "string" && label.trim()) {
          const name = "text:" + label.trim().slice(0, 40);
          const n = (counts.get(name) ?? 0) + 1;
          counts.set(name, n);
          const entry = { key: name + "#" + n, hosts: [] };
          composites.push(entry);
          mine = [...mine, entry];
        }
        hosts.push({ node: f.stateNode, owners: mine });
      }
      if (f.child) visit(f.child, mine);
    }
  };
  visit(ROOT, []);
  ${collect}
`;

export const realLayoutScript = walker(`
  return Promise.all(hosts.map((h) => new Promise((done) => {
    if (!h.node.measureInWindow) return done(null);
    const timer = setTimeout(() => done(null), 3000);
    try { h.node.measureInWindow((x, y, w, hh) => { clearTimeout(timer); done([x, y, w, hh]); }); } catch { clearTimeout(timer); done(null); }
  }))).then((frames) => {
    frames.forEach((frame, i) => { if (frame && frame[2] > 0 && frame[3] > 0) for (const o of hosts[i].owners) o.hosts.push(frame); });
    return composites.filter((c) => c.hosts.length).map((c) => ({ key: c.key, box: [Math.min(...c.hosts.map((b) => b[0])), Math.min(...c.hosts.map((b) => b[1])), Math.max(...c.hosts.map((b) => b[0] + b[2])), Math.max(...c.hosts.map((b) => b[1] + b[3]))] }));
  });
`).replace("ROOT", () => "[...globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(1)][0].current.child");

export const demoLayoutScript = (inset) =>
  walker(`
  for (const h of hosts) {
    if (!(h.node instanceof Element) || !/(^| )css-(view|text|textinput|textHasAncestor|image|accessibilityImage)/.test(h.node.getAttribute("class") ?? "")) continue;
    const r = h.node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let a = h.node.parentElement; a; a = a.parentElement) {
      if (getComputedStyle(a).overflow === "visible") continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    if (right - left <= 0 || bottom - top <= 0) continue;
    const frame = [r.x - ${inset.left}, r.y - ${inset.top}, r.width, r.height];
    for (const o of h.owners) o.hosts.push(frame);
  }
  return composites.filter((c) => c.hosts.length).map((c) => ({ key: c.key, box: [Math.min(...c.hosts.map((b) => b[0])), Math.min(...c.hosts.map((b) => b[1])), Math.max(...c.hosts.map((b) => b[0] + b[2])), Math.max(...c.hosts.map((b) => b[1] + b[3]))] }));
`).replace("ROOT", () => "(() => { const host = document.getElementById('root'); const key = Object.keys(host).find((k) => k.startsWith('__reactContainer$')); return host[key].stateNode.current.child; })()");
