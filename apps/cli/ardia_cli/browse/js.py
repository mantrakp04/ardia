LIBRARY = r"""
(() => {
  if (globalThis.ardiaBrowse) return true;
  const NATIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION", "LABEL", "IFRAME", "VIDEO", "AUDIO"]);
  const ROLES = new Set(["button", "link", "checkbox", "radio", "textbox", "combobox", "listbox", "option", "menuitem",
    "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "switch", "tab", "treeitem", "searchbox"]);
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const matches = (value, wanted, exact) => {
    const v = norm(value);
    if (!v) return false;
    return exact ? v === wanted : v.toLowerCase().includes(String(wanted).toLowerCase());
  };
  const all = (root) => Array.from((root || document).querySelectorAll("*"));
  const deep = (root) => {
    const out = [];
    const walk = (node) => {
      for (const el of node.querySelectorAll("*")) {
        out.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root || document);
    return out;
  };
  const api = {
    describe(el) {
      if (!el || el.nodeType !== 1) return String(el);
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += "." + cls.join(".");
      return "<" + s + ">";
    },
    visible(el) {
      if (!el || !el.isConnected) return false;
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    query(selector, root) {
      root = root || document;
      if (/^(\/\/|\(\/\/|xpath=)/.test(selector)) {
        const expr = selector.replace(/^xpath=/, "");
        const r = document.evaluate(expr, root, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return r.singleNodeValue;
      }
      return root.querySelector(selector.replace(/^css=/, ""));
    },
    queryAll(selector, root) {
      root = root || document;
      if (/^(\/\/|\(\/\/|xpath=)/.test(selector)) {
        const expr = selector.replace(/^xpath=/, "");
        const r = document.evaluate(expr, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const out = [];
        for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i));
        return out;
      }
      return Array.from(root.querySelectorAll(selector.replace(/^css=/, "")));
    },
    rect(el) {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    viewport() {
      const d = document.documentElement;
      return { width: innerWidth, height: innerHeight, scrollX, scrollY,
        docWidth: Math.max(d.scrollWidth, document.body ? document.body.scrollWidth : 0),
        docHeight: Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0), dpr: devicePixelRatio };
    },
    hitTest(el, x, y) {
      let hit = document.elementFromPoint(x, y);
      while (hit && hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
      }
      if (!hit) return "nothing (the point is outside the page)";
      let node = hit;
      while (node) {
        if (node === el) return null;
        node = node.parentNode || node.host;
      }
      if (el.contains && el.contains(hit)) return null;
      const label = el.labels && Array.from(el.labels).some((l) => l === hit || l.contains(hit));
      if (label) return null;
      return api.describe(hit);
    },
    clickables(root) {
      const out = [];
      const hints = [];
      for (const el of deep(root || document)) {
        if (out.length >= 300) break;
        if (NATIVE.has(el.tagName)) continue;
        const role = el.getAttribute("role");
        if (role && ROLES.has(role)) continue;
        if (el.isContentEditable && el.parentElement && el.parentElement.isContentEditable) continue;
        const h = [];
        const style = getComputedStyle(el);
        if (style.cursor === "pointer") {
          const parent = el.parentElement;
          if (!parent || getComputedStyle(parent).cursor !== "pointer") h.push("cursor:pointer");
        }
        if (el.hasAttribute("onclick")) h.push("onclick");
        const tab = el.getAttribute("tabindex");
        if (tab !== null && Number(tab) >= 0) h.push("tabindex");
        if (el.isContentEditable) h.push("contenteditable");
        if (!h.length) continue;
        if (!api.visible(el)) continue;
        out.push(el);
        hints.push(h);
      }
      return { elements: out, hints };
    },
    readable(root) {
      root = root || document.body || document.documentElement;
      const lines = [];
      const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD", "IFRAME"]);
      const BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|FORM|FIELDSET|UL|OL|TABLE|TR|BLOCKQUOTE|PRE|FIGURE|DETAILS|DL|DT|DD|ADDRESS|HR|BR|LABEL|SELECT|TEXTAREA|BUTTON)$/;
      let buffer = "";
      const flush = () => { const t = norm(buffer); if (t) lines.push(t); buffer = ""; };
      const walk = (node) => {
        if (node.nodeType === 3) { buffer += node.nodeValue; return; }
        if (node.nodeType !== 1) return;
        if (SKIP.has(node.tagName)) return;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return;
        const tag = node.tagName;
        const h = /^H([1-6])$/.exec(tag);
        if (h) { flush(); const t = norm(node.innerText); if (t) { lines.push(""); lines.push("#".repeat(Number(h[1])) + " " + t); lines.push(""); } return; }
        if (tag === "LI") { flush(); const t = norm(node.innerText); if (t) lines.push("- " + t); return; }
        if (tag === "PRE") { flush(); lines.push("```"); lines.push(node.innerText.replace(/\n+$/, "")); lines.push("```"); return; }
        if (tag === "INPUT" || tag === "IMG") { if (tag === "IMG" && node.alt) buffer += " " + node.alt + " "; return; }
        const block = BLOCK.test(tag) || style.display === "block" || style.display === "flex" || style.display === "grid";
        if (block) flush();
        for (const child of node.childNodes) walk(child);
        if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child);
        if (block) flush();
      };
      walk(root);
      flush();
      const out = [];
      for (const line of lines) {
        if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
        out.push(line);
      }
      while (out.length && out[out.length - 1] === "") out.pop();
      return out.join("\n");
    },
    innermost(candidates) {
      return candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
    },
    findText(text, exact) {
      const hits = deep(document).filter((el) => !["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT"].includes(el.tagName)
        && matches(el.innerText != null ? el.innerText : el.textContent, text, exact));
      const inner = api.innermost(hits);
      return inner.find((el) => api.visible(el)) || inner[0] || null;
    },
    labelText(el) {
      const parts = [];
      if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
      const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      for (const id of ids) { const ref = document.getElementById(id); if (ref) parts.push(ref.innerText || ref.textContent); }
      if (el.labels) for (const label of el.labels) parts.push(label.innerText || label.textContent);
      return parts;
    },
    findLabel(text, exact) {
      for (const el of deep(document)) {
        if (api.labelText(el).some((t) => matches(t, text, exact))) return el;
      }
      return null;
    },
    findAttr(attr, text, exact) {
      for (const el of deep(document)) {
        if (el.hasAttribute(attr) && matches(el.getAttribute(attr), text, exact)) return el;
      }
      return null;
    },
    styles(el) {
      const style = getComputedStyle(el);
      const out = {};
      for (let i = 0; i < style.length; i++) out[style[i]] = style.getPropertyValue(style[i]);
      return out;
    },
    info(el) {
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        checked: el.checked === true || el.getAttribute("aria-checked") === "true",
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        editable: el.isContentEditable || ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly),
        value: "value" in el ? el.value : (el.isContentEditable ? el.innerText : null),
        draggable: el.draggable === true || el.getAttribute("draggable") === "true",
        focused: document.activeElement === el || (el.contains && el.contains(document.activeElement)),
        connected: el.isConnected,
      };
    },
    selectOptions(el, values) {
      if (el.tagName !== "SELECT") throw new Error("Element is not a <select>: " + api.describe(el));
      const options = Array.from(el.options);
      const picked = [];
      for (const value of values) {
        const option = options.find((o) => o.value === value) || options.find((o) => norm(o.label) === value)
          || options.find((o) => norm(o.textContent) === value);
        if (!option) throw new Error("No option matches " + JSON.stringify(value) + " in " + api.describe(el));
        picked.push(option);
      }
      if (!el.multiple && picked.length > 1) throw new Error("The <select> takes one option, got " + picked.length);
      for (const option of options) option.selected = picked.includes(option);
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return picked.map((o) => o.value);
    },
    storage(kind, op, key, value) {
      const store = kind === "session" ? sessionStorage : localStorage;
      if (op === "set") { store.setItem(key, value); return null; }
      if (op === "clear") { store.clear(); return null; }
      if (op === "remove") { store.removeItem(key); return null; }
      if (key != null) return { [key]: store.getItem(key) };
      const out = {};
      for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = store.getItem(k); }
      return out;
    },
    vitals() {
      return new Promise((resolve) => {
        const result = { url: location.href, ttfb: null, fcp: null, lcp: null, lcpElement: null, cls: 0, inp: null };
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) result.ttfb = Math.max(0, nav.responseStart - (nav.activationStart || 0));
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        if (paint) result.fcp = paint.startTime;
        const observe = (type, fn) => { try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) {} };
        observe("largest-contentful-paint", (e) => { result.lcp = e.startTime; result.lcpElement = e.element ? api.describe(e.element).replace(/^<|>$/g, "") : null; });
        observe("layout-shift", (e) => { if (!e.hadRecentInput) result.cls += e.value; });
        observe("event", (e) => { if (e.interactionId) result.inp = Math.max(result.inp || 0, e.duration); });
        setTimeout(() => resolve(result), 300);
      });
    },
    inputWatch() {
      if (!globalThis.ardiaBrowseInput) {
        const counts = { mousedown: 0, mouseup: 0, click: 0, mousemove: 0, keydown: 0, keyup: 0, wheel: 0, beforeinput: 0, input: 0 };
        for (const type of Object.keys(counts)) {
          addEventListener(type, (event) => { if (event.isTrusted) counts[type] += 1; }, { capture: true, passive: true });
        }
        Object.defineProperty(globalThis, "ardiaBrowseInput", { value: counts, enumerable: false });
      }
      const active = document.activeElement;
      return Object.assign({ activeFrame: !!active && (active.tagName === "IFRAME" || active.tagName === "FRAME") }, globalThis.ardiaBrowseInput);
    },
    overFrame(x, y) {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit.tagName === "IFRAME" || hit.tagName === "FRAME");
    },
    pushState(url) {
      history.pushState({}, "", url);
      dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      return location.href;
    },
  };
  Object.defineProperty(globalThis, "ardiaBrowse", { value: api, configurable: false, enumerable: false });
  return true;
})()
"""
