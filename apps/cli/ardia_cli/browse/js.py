LIBRARY = r"""
(() => {
  if (globalThis.ardiaBrowse) return true;
  const NATIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION", "LABEL", "IFRAME", "VIDEO", "AUDIO"]);
  const ROLES = new Set(["button", "link", "checkbox", "radio", "textbox", "combobox", "listbox", "option", "menuitem",
    "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "switch", "tab", "treeitem", "searchbox"]);
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const suggestionWatches = new WeakMap();
  const SUGGESTION_ATTRIBUTES = ["hidden", "style", "class", "id", "role", "aria-busy", "aria-selected", "aria-disabled", "aria-label", "data-value",
    "value", "aria-controls", "aria-owns", "aria-expanded", "aria-activedescendant"];
  const CONTROLS = "input:not([type=hidden]), textarea, select, button[aria-haspopup], [aria-haspopup=listbox], [aria-haspopup=true], [role=combobox], [role=searchbox], [role=textbox], [contenteditable=true]";
  const IMPLICIT_ROLES = {
    main: "main", navigation: "nav", banner: "body > header", contentinfo: "body > footer", dialog: "dialog", form: "form",
    table: "table", row: "tr", cell: "td", columnheader: "th", list: "ul, ol", listitem: "li", article: "article", search: "search",
    button: "button, input[type=button], input[type=submit], input[type=reset], summary", link: "a[href], area[href]",
    heading: "h1, h2, h3, h4, h5, h6", checkbox: "input[type=checkbox]", radio: "input[type=radio]", combobox: "select",
    textbox: "input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], textarea", img: "img[alt]",
  };
  const ROLE_WORDS = new Set([...Object.keys(IMPLICIT_ROLES), "grid", "gridcell", "rowgroup", "tab", "tablist", "tabpanel", "menu", "menubar",
    "menuitem", "option", "listbox", "tree", "treeitem", "toolbar", "tooltip", "alert", "alertdialog", "status", "switch", "slider", "region"]);
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
      const found = api.queryAll(selector, root);
      return found.find((el) => api.visible(el)) || found[0] || null;
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
      const text = /^text=(.*)$/s.exec(selector);
      if (text) {
        const quoted = /^(["'])(.*)\1$/s.exec(text[1].trim());
        const wanted = quoted ? quoted[2] : text[1].trim();
        const hits = deep(root).filter((el) => !["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT"].includes(el.tagName)
          && matches(el.innerText != null ? el.innerText : el.textContent, wanted, !!quoted));
        return api.innermost(hits);
      }
      const role = /^role=([A-Za-z]+)(?:\[name=(["'])(.*)\2\])?$/s.exec(selector.trim());
      if (role) {
        const all = Array.from(root.querySelectorAll(api.roleCss(role[1])));
        return role[3] == null ? all : all.filter((el) => matches(api.accessibleText(el), role[3], false));
      }
      let css = selector.replace(/^css=/, "").replace(/\[role=(["']?)([A-Za-z]+)\1\]/g, (whole, q, name) => api.roleCss(name.toLowerCase()) === `[role="${name.toLowerCase()}"]` ? whole : `:is(${api.roleCss(name.toLowerCase())})`);
      if (/^[a-z]+$/.test(css) && ROLE_WORDS.has(css) && !root.querySelector(css)) css = api.roleCss(css);
      const parts = css.split(/:has-text\(\s*(["'])(.*?)\1\s*\)/);
      if (parts.length === 1) return Array.from(root.querySelectorAll(css));
      let found = null;
      for (let i = 0; i < parts.length; i += 3) {
        const piece = parts[i];
        if (piece.trim() || found === null) {
          const scoped = found === null ? Array.from(root.querySelectorAll(piece.trim() ? piece : "*"))
            : found.flatMap((el) => Array.from(el.querySelectorAll(":scope " + piece)));
          found = [...new Set(scoped)];
        }
        if (i + 2 < parts.length) found = found.filter((el) => matches(el.innerText != null ? el.innerText : el.textContent, parts[i + 2], false));
      }
      return found;
    },
    roleCss(name) {
      const implicit = IMPLICIT_ROLES[name];
      return implicit ? `[role="${name}"], ${implicit}` : `[role="${name}"]`;
    },
    accessibleText(el) {
      return el.getAttribute("aria-label") || api.labelText(el).join(" ") || el.getAttribute("title") || el.innerText || el.textContent || el.value || "";
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
        if ((tag === "TD" || tag === "TH") && node.previousElementSibling) buffer += " | ";
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
    comboKind(el) {
      if (el.tagName === "SELECT") return "select";
      const role = (el.getAttribute("role") || "").toLowerCase();
      const auto = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
      const editable = el.isContentEditable || ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly);
      if (el.tagName === "INPUT" && el.list) return "datalist";
      if (editable && (role === "combobox" || role === "searchbox" && auto || auto === "list" || auto === "both" || el.closest("[role=combobox]"))) return "typeahead";
      if (role === "combobox" || (el.getAttribute("aria-haspopup") || "").toLowerCase() === "listbox") return "button";
      return null;
    },
    isControl(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.matches(CONTROLS)) return true;
      return api.comboKind(node) !== null;
    },
    ownerOf(list, el) {
      if (!list.id) return null;
      for (const node of el.ownerDocument.querySelectorAll("[aria-controls], [aria-owns]")) {
        const ids = ["aria-controls", "aria-owns"].flatMap((key) => (node.getAttribute(key) || "").split(/\s+/));
        if (ids.includes(list.id)) return node;
      }
      return null;
    },
    popupIds(el) {
      const ids = [];
      for (const node of [el, el.closest("[role=combobox]")]) {
        if (!node) continue;
        for (const key of ["aria-controls", "aria-owns"]) ids.push(...(node.getAttribute(key) || "").split(/\s+/).filter(Boolean));
      }
      return ids;
    },
    popupsOf(el) {
      const doc = el.ownerDocument;
      const roots = api.popupIds(el).map((id) => doc.getElementById(id)).filter(Boolean);
      const active = el.getAttribute("aria-activedescendant");
      const activeNode = active && doc.getElementById(active);
      if (activeNode) roots.push(activeNode.closest("[role=listbox]") || activeNode.parentElement);
      if (roots.length || api.popupIds(el).length || active) return roots;
      const component = api.componentOf(el);
      return component ? Array.from(component.querySelectorAll("[role=listbox]")) : [];
    },
    componentOf(el) {
      const mine = (owner) => !owner || owner === el || owner.contains(el) || el.contains(owner);
      let node = el.parentElement;
      while (node && node !== el.ownerDocument.body) {
        const others = Array.from(node.querySelectorAll("*")).filter((field) => field !== el && !el.contains(field) && !field.contains(el) && api.isControl(field));
        if (others.length) return null;
        const lists = Array.from(node.querySelectorAll("[role=listbox]"));
        if (lists.length) return lists.every((list) => mine(api.ownerOf(list, el))) ? node : null;
        node = node.parentElement;
      }
      return null;
    },
    unlinkedListboxes(el) {
      return deep(el.ownerDocument).filter((node) => node.getAttribute && node.getAttribute("role") === "listbox" && api.visible(node))
        .map((node) => norm(node.getAttribute("aria-label") || node.id || api.describe(node))).slice(0, 8);
    },
    suggestions(el) {
      const seen = new Set();
      const out = [];
      const add = (node) => {
        if (seen.has(node) || !api.visible(node) || node.closest("select, datalist")) return;
        if (node.getAttribute("aria-disabled") === "true") return;
        seen.add(node);
        out.push(node);
      };
      for (const root of api.popupsOf(el)) {
        if (root.getAttribute("role") === "option") add(root);
        for (const node of root.querySelectorAll("[role=option]")) add(node);
      }
      const texts = out.map((node) => api.optionFacts(node));
      Object.defineProperty(globalThis, "ardiaBrowseSuggestions", { value: texts, configurable: true, enumerable: false });
      return out.slice(0, 200);
    },
    optionFacts(node) {
      const shown = norm(node.innerText || node.textContent);
      return {
        text: norm(node.getAttribute("aria-label")) || shown,
        exact: [node.getAttribute("aria-label"), node.getAttribute("data-value"), node.getAttribute("value"), shown].map(norm).filter(Boolean),
        pieces: String(node.innerText || node.textContent || "").split(/\n|·|•|\||—| - /).map(norm).filter(Boolean),
        selected: node.getAttribute("aria-selected") === "true",
      };
    },
    optionSignature(el) {
      const parts = [];
      for (const root of api.popupsOf(el)) {
        if (!api.visible(root)) continue;
        for (const node of root.matches("[role=option]") ? [root] : root.querySelectorAll("[role=option]")) {
          if (!api.visible(node)) continue;
          const facts = api.optionFacts(node);
          parts.push([node.id || "", facts.text, ...facts.exact].join("\u0001"));
        }
      }
      return parts.join("\u0002");
    },
    watchSuggestions(el) {
      api.unwatchSuggestions(el);
      const watch = { lastInput: 0, lastChange: 0, observer: null, signature: api.optionSignature(el) };
      watch.observer = new MutationObserver(() => {
        const signature = api.optionSignature(el);
        if (signature !== watch.signature) {
          watch.signature = signature;
          watch.lastChange = performance.now();
        }
      });
      watch.observer.observe(el.ownerDocument.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: SUGGESTION_ATTRIBUTES });
      watch.onInput = () => { watch.lastInput = performance.now(); watch.firstInput = watch.firstInput || watch.lastInput; };
      el.addEventListener("input", watch.onInput, true);
      watch.started = performance.now();
      suggestionWatches.set(el, watch);
      return true;
    },
    suggestionState(el) {
      const watch = suggestionWatches.get(el);
      const busy = [el, ...api.popupsOf(el)].some((node) => node.getAttribute("aria-busy") === "true");
      return watch ? { busy, since: Math.max(watch.lastInput, watch.started), first: watch.firstInput || watch.started, changed: watch.lastChange, now: performance.now() }
        : { busy, since: 0, first: 0, changed: 0, now: performance.now() };
    },
    unwatchSuggestions(el) {
      const watch = suggestionWatches.get(el);
      if (watch) {
        watch.observer.disconnect();
        el.removeEventListener("input", watch.onInput, true);
      }
      suggestionWatches.delete(el);
      return true;
    },
    datalistValues(el) {
      return el.list ? Array.from(el.list.options).map((o) => o.value) : [];
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
      if (!globalThis.ardiaBrowseDragStarts) {
        const drags = { accepted: 0, dragend: 0, drop: 0, dispatched: [] };
        for (const type of ["dragstart", "dragend", "drop"]) {
          addEventListener(type, (event) => {
            if (!event.isTrusted) return;
            if (type === "dragstart") drags.dispatched.push(event);
            else drags[type] += 1;
          }, { capture: true, passive: true });
        }
        Object.defineProperty(globalThis, "ardiaBrowseDragStarts", { value: drags, enumerable: false });
      }
      const drags = globalThis.ardiaBrowseDragStarts;
      drags.accepted += drags.dispatched.filter((event) => !event.defaultPrevented).length;
      drags.dispatched.length = 0;
      const active = document.activeElement;
      return Object.assign({ activeFrame: !!active && (active.tagName === "IFRAME" || active.tagName === "FRAME") }, globalThis.ardiaBrowseInput, {
        dragstart: drags.accepted,
        dragend: drags.dragend,
        drop: drags.drop,
      });
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
