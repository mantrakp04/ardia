LIBRARY = r"""
(() => {
  if (globalThis.ardiaBrowse) return true;
  const NATIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION", "LABEL", "IFRAME", "VIDEO", "AUDIO"]);
  const ROLES = new Set(["button", "link", "checkbox", "radio", "textbox", "combobox", "listbox", "option", "menuitem",
    "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "switch", "tab", "treeitem", "searchbox"]);
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const suggestionWatches = new WeakMap();
  let reactionWatch = null;
  const SUGGESTION_ATTRIBUTES = ["hidden", "style", "class", "id", "role", "aria-busy", "aria-selected", "aria-disabled", "aria-label", "data-value",
    "value", "aria-controls", "aria-owns", "aria-expanded", "aria-activedescendant"];
  const CONTROLS = "input:not([type=hidden]), textarea, select, button[aria-haspopup], [aria-haspopup=listbox], [aria-haspopup=true], [role=combobox], [role=searchbox], [role=textbox], [contenteditable=true]";
  const IMPLICIT_ROLES = {
    main: "main", navigation: "nav", banner: "body > header", contentinfo: "body > footer", dialog: "dialog", form: "form",
    table: "table", row: "tr", cell: "td", columnheader: "th", list: "ul, ol", listitem: "li", article: "article", search: "search",
    button: "button, input[type=button], input[type=submit], input[type=reset], summary", link: "a[href], area[href]",
    heading: "h1, h2, h3, h4, h5, h6", checkbox: "input[type=checkbox]", radio: "input[type=radio]",
    combobox: "select:not([multiple]):not([size]), select[size='']:not([multiple]), select[size='0']:not([multiple]), select[size='1']:not([multiple]), input[list]:not([type]), input[list][type=text], input[list][type=search], input[list][type=email], input[list][type=tel], input[list][type=url]",
    listbox: "select[multiple], select[size]:not([size='']):not([size='0']):not([size='1']), datalist", option: "option",
    textbox: "input:not([type]):not([list]), input[type=text]:not([list]), input[type=email]:not([list]), input[type=tel]:not([list]), input[type=url]:not([list]), textarea",
    searchbox: "input[type=search]:not([list])", spinbutton: "input[type=number]", slider: "input[type=range]",
    progressbar: "progress", meter: "meter", separator: "hr", group: "fieldset, details, optgroup", complementary: "aside",
    region: "section[aria-label], section[aria-labelledby]", figure: "figure", rowgroup: "thead, tbody, tfoot", status: "output",
    img: "img:not([alt=''])",
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
      const chain = api.chainParts(selector);
      if (chain.length > 1) {
        const found = api.queryAll(selector, root);
        return /^nth=-?\d+$/.test(chain[chain.length - 1]) ? found[0] || null : found.find((el) => api.visible(el)) || found[0] || null;
      }
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
      const chain = api.chainParts(selector);
      if (chain.length > 1) {
        let found = api.queryAll(chain[0], root);
        for (const part of chain.slice(1)) {
          const nth = /^nth=(-?\d+)$/.exec(part);
          if (nth) {
            const picked = found.at(Number(nth[1]));
            found = picked ? [picked] : [];
          } else {
            found = [...new Set(found.flatMap((el) => api.queryAll(part, el)))];
          }
        }
        return found;
      }
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
      css = api.outsideStrings(css, (piece) => piece.replace(/:text\(/g, ":has-text("));
      if (/^[a-z]+$/.test(css) && ROLE_WORDS.has(css) && !root.querySelector(css)) css = api.roleCss(css);
      const parts = api.textPseudos(css);
      if (parts.length === 1) return Array.from(root.querySelectorAll(css));
      let found = null;
      for (let i = 0; i < parts.length; i += 4) {
        const piece = parts[i];
        if (piece.trim() || found === null) {
          const scoped = found === null ? Array.from(root.querySelectorAll(piece.trim() ? piece : "*"))
            : found.flatMap((el) => Array.from(el.querySelectorAll(":scope " + piece)));
          found = [...new Set(scoped)];
        }
        if (i + 3 < parts.length) {
          const exact = parts[i + 1] === "text-is";
          found = found.filter((el) => matches(el.innerText != null ? el.innerText : el.textContent, parts[i + 3], exact));
        }
      }
      return found;
    },
    textPseudos(css) {
      const parts = [];
      const pseudo = /:(has-text|text-is)\(\s*(["'])(.*?)\2\s*\)/y;
      let quote = "";
      let bracket = 0;
      let start = 0;
      for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === "\\") { i++; continue; }
        if (quote) { if (c === quote) quote = ""; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === "[") { bracket++; continue; }
        if (c === "]") { bracket--; continue; }
        if (bracket || c !== ":") continue;
        pseudo.lastIndex = i;
        const hit = pseudo.exec(css);
        if (!hit) continue;
        parts.push(css.slice(start, i), hit[1], hit[2], hit[3]);
        start = pseudo.lastIndex;
        i = start - 1;
      }
      parts.push(css.slice(start));
      return parts;
    },
    outsideStrings(css, change) {
      let out = "";
      let plain = "";
      let quote = "";
      let bracket = 0;
      for (let i = 0; i < css.length; i++) {
        const c = css[i];
        const free = !quote && !bracket;
        if (free && c !== "\\" && c !== '"' && c !== "'" && c !== "[") { plain += c; continue; }
        if (plain) { out += change(plain); plain = ""; }
        if (c === "\\") { out += c + (css[i + 1] || ""); i++; continue; }
        out += c;
        if (quote) { if (c === quote) quote = ""; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === "[") bracket++;
        else if (c === "]") bracket--;
      }
      return out + (plain ? change(plain) : "");
    },
    chainParts(selector) {
      const parts = [];
      let depth = 0;
      let quote = "";
      let start = 0;
      for (let i = 0; i < selector.length; i++) {
        const c = selector[i];
        if (c === "\\") { i++; continue; }
        if (quote) { if (c === quote) quote = ""; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (depth === 0 && c === ">" && selector[i + 1] === ">") {
          parts.push(selector.slice(start, i).trim());
          start = i + 2;
          i++;
        }
      }
      parts.push(selector.slice(start).trim());
      return parts.filter(Boolean).length === parts.length ? parts : [selector];
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
    scope() {
      const text = ((document.body && document.body.innerText) || "").slice(0, 200000);
      const counts = [];
      const range = text.match(/\b\d[\d,.]*\s*[-–—]\s*\d[\d,.]*\s+of\s+(about\s+|over\s+)?\d[\d,.]*\+?(\s+[A-Za-z]+)?/);
      if (range) counts.push(range[0]);
      const total = text.match(/\b\d[\d,.]*\+?\s+(results|items|products|listings|jobs|homes|properties|matches|reviews|rentals|vehicles|cars|hotels|apartments|roles|positions|articles|stores|locations|courses|events|deals)\b/i);
      if (total && !(range && range[0].includes(total[0]))) counts.push(total[0]);
      const paged = text.match(/\bpage\s+\d+\s+of\s+\d+\b/i);
      if (paged) counts.push(paged[0]);
      const controls = [];
      const named = (pattern) => {
        for (const el of document.querySelectorAll("a, button, [role=button], [role=link]")) {
          const name = ((el.getAttribute("aria-label") || el.innerText || "").trim()).slice(0, 40);
          if (pattern.test(name) && api.visible(el)) return true;
        }
        return false;
      };
      if (document.querySelector("a[rel=next], link[rel=next]") || named(/^(next( page)?|next ›|›|»)$/i)) controls.push("a Next page link");
      if (named(/^(load|show|see|view) more\b/i)) controls.push("a Load more button");
      const pager = document.querySelector("nav[aria-label*=pagination i], [class*=pagination i]");
      if (pager) {
        const numbers = Array.from(pager.querySelectorAll("a, button")).map((el) => parseInt((el.innerText || "").replace(/[^\d]/g, ""), 10)).filter((n) => n > 0 && n < 100000);
        if (numbers.length) controls.push("pages up to " + Math.max(...numbers));
      }
      const parts = [];
      if (counts.length) parts.push("page says " + counts.map((count) => JSON.stringify(count.trim())).join(", "));
      if (controls.length) parts.push("has " + controls.join(", "));
      return parts.join("; ");
    },
    dismissConsent(x, y) {
      const about = /cookie|consent|gdpr|privacy|tracking|personal data|datenschutz|partners/i;
      const vendor = "[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=onetrust i],[class*=onetrust i],[id*=osano i],[class*=osano i],[id*=didomi i],[id*=usercentrics i],[id*=truste i],[class*=truste i],[class*=qc-cmp i],[id*=sp_message i],[id*=cmp i],[class*=cmp-],[role=dialog],[role=alertdialog],[aria-modal=true]";
      const reject = /^(reject|decline|refuse|deny|disagree)\b|\b(only|strictly) (essential|necessary|required)\b|\b(necessary|essential|required) (cookies )?only\b|^use (only )?necessary|continue without (accepting|agreeing)|^confirm my choices$|^save (my )?(choices|preferences|settings)$/i;
      const accept = /^(accept|agree|allow|i agree|i accept|got it|ok|okay|understood|continue|yes,? i agree)\b/i;
      const close = /^(close|dismiss|no,? thanks|not now|×|✕|x)$/i;
      const roots = [];
      const hit = document.elementFromPoint(x, y);
      for (let node = hit; node && node !== document.body && node !== document.documentElement; node = node.parentElement) roots.push(node);
      const box = hit ? hit.getBoundingClientRect() : null;
      const backdrop = box && getComputedStyle(hit).position === "fixed" && box.width * box.height >= innerWidth * innerHeight * 0.5 && !hit.querySelector("button, a, [role=button]");
      if (backdrop) for (const el of document.querySelectorAll(vendor)) roots.push(el);
      const seen = new Set();
      let best = null;
      for (const root of roots) {
        if (seen.has(root) || !api.visible(root)) continue;
        seen.add(root);
        const text = (root.innerText || "").slice(0, 6000);
        if (!about.test(text) || text.length > 5000) continue;
        for (const button of root.querySelectorAll("button, [role=button], a, input[type=button], input[type=submit]")) {
          if (!api.visible(button)) continue;
          const name = ((button.innerText || button.value || "").trim() || button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
          if (!name || name.length > 60) continue;
          const rank = reject.test(name) ? 0 : accept.test(name) ? 1 : close.test(name) ? 2 : -1;
          if (rank >= 0 && (!best || rank < best.rank)) best = { rank, button, name };
        }
        if (best && best.rank === 0) break;
      }
      if (!best) return null;
      best.button.click();
      return { name: best.name, choice: ["reject", "accept", "close"][best.rank], layer: api.describe(best.button.closest(vendor) || best.button.parentElement) };
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
      const CELL_ROLES = new Set(["gridcell", "cell", "columnheader", "rowheader"]);
      const GRID_ROLES = new Set(["grid", "treegrid", "table"]);
      const roleOf = (el) => (el.getAttribute("role") || "").trim().toLowerCase();
      const LAYOUT_INSIDE = "table, [role=grid], [role=table], h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote";
      const isRow = (el) => (el.tagName === "TR" || roleOf(el) === "row") && !el.querySelector(LAYOUT_INSIDE) && (el.innerText || "").length <= 500;
      const isCell = (el) => el.tagName === "TD" || el.tagName === "TH" || CELL_ROLES.has(roleOf(el));
      const rowsRendered = (grid) => Array.from(grid.querySelectorAll("tr, [role=row]")).filter((row) => row.closest("table, [role=grid], [role=treegrid], [role=table]") === grid).length;
      const virtualNote = (grid) => {
        const total = Number(grid.getAttribute("aria-rowcount"));
        const shown = rowsRendered(grid);
        if (!Number.isFinite(total) || total <= shown) return "";
        return `(${shown} of ${total} rows rendered; the grid is virtualized: sort, filter or scroll it to see others, or read -s <grid> --scroll)`;
      };
      let buffer = "";
      let row = null;
      const flush = () => { const t = norm(buffer); if (t) lines.push(t); buffer = ""; };
      const walk = (node) => {
        if (node.nodeType === 3) { buffer += node.nodeValue; return; }
        if (node.nodeType !== 1) return;
        if (SKIP.has(node.tagName)) return;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return;
        const tag = node.tagName;
        if (row) {
          if (isCell(node)) {
            if (row.cells++) buffer += " | ";
          } else if (tag === "INPUT" || tag === "IMG") {
            if (tag === "IMG" && node.alt) buffer += " " + node.alt + " ";
            return;
          } else if (BLOCK.test(tag) || style.display !== "inline") buffer += " ";
          for (const child of node.childNodes) walk(child);
          if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child);
          return;
        }
        if (isRow(node)) {
          flush();
          row = { cells: 0 };
          try {
            for (const child of node.childNodes) walk(child);
            if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child);
          } finally {
            row = null;
          }
          flush();
          return;
        }
        const h = /^H([1-6])$/.exec(tag);
        if (h) { flush(); const t = norm(node.innerText); if (t) { lines.push(""); lines.push("#".repeat(Number(h[1])) + " " + t); lines.push(""); } return; }
        if (tag === "LI") { flush(); const t = norm(node.innerText); if (t) lines.push("- " + t); return; }
        if (tag === "PRE") { flush(); lines.push("```"); lines.push(node.innerText.replace(/\n+$/, "")); lines.push("```"); return; }
        if (tag === "INPUT" || tag === "IMG") { if (tag === "IMG" && node.alt) buffer += " " + node.alt + " "; return; }
        if (isCell(node) && node.previousElementSibling) buffer += " | ";
        const block = BLOCK.test(tag) || style.display === "block" || style.display === "flex" || style.display === "grid";
        if (block) flush();
        for (const child of node.childNodes) walk(child);
        if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child);
        if (block) flush();
        if (tag === "TABLE" || GRID_ROLES.has(roleOf(node))) {
          const note = virtualNote(node);
          if (note) { flush(); lines.push(note); }
        }
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
    matchRank(value, wanted, exact) {
      const v = norm(value);
      if (!v) return 0;
      if (exact) return v === wanted ? 3 : 0;
      const have = v.toLowerCase();
      const want = norm(wanted).toLowerCase();
      if (!want) return 0;
      if (have === want || have.replace(/[\s*:]+$/, "") === want) return 3;
      const at = have.indexOf(want);
      if (at < 0) return 0;
      const word = (c) => /[\p{L}\p{N}]/u.test(c || "");
      const whole = (index) => !word(have[index - 1]) && !word(have[index + want.length]);
      for (let index = at; index >= 0; index = have.indexOf(want, index + 1)) if (whole(index)) return 2;
      return 1;
    },
    bestMatch(candidates, rank) {
      let best = 0;
      let picked = [];
      for (const el of candidates) {
        const level = rank(el);
        if (level > best) { best = level; picked = [el]; }
        else if (level && level === best) picked.push(el);
      }
      return picked.find((el) => api.visible(el)) || picked[0] || null;
    },
    findText(text, exact) {
      const hits = deep(document).filter((el) => !["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT"].includes(el.tagName)
        && matches(el.innerText != null ? el.innerText : el.textContent, text, exact));
      const inner = api.innermost(hits);
      return api.bestMatch(inner, (el) => api.matchRank(el.innerText != null ? el.innerText : el.textContent, text, exact));
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
      return api.bestMatch(deep(document), (el) => Math.max(0, ...api.labelText(el).map((t) => api.matchRank(t, text, exact))));
    },
    findAttr(attr, text, exact) {
      return api.bestMatch(deep(document).filter((el) => el.hasAttribute(attr)), (el) => api.matchRank(el.getAttribute(attr), text, exact));
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
      if (component) return Array.from(component.querySelectorAll("[role=listbox]"));
      const opened = api.openedList(el);
      return opened ? [opened] : [];
    },
    filterField(el) {
      if (!el || el.nodeType !== 1) return false;
      const role = (el.getAttribute("role") || "").toLowerCase();
      const editable = el.isContentEditable || ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly);
      if (!editable) return false;
      if (role === "searchbox" || (el.tagName === "INPUT" && (el.type || "").toLowerCase() === "search") || el.closest("[role=search], search")) return true;
      if (el.getAttribute("aria-controls")) return true;
      const words = [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"), el.id, ...api.labelText(el)].join(" ");
      return /\b(search|filter|find)\b/i.test(words);
    },
    watchReaction(el, id) {
      const field = el || document.activeElement;
      if (!api.filterField(field)) return false;
      api.unwatchReaction();
      const watch = { id, field, lastInput: performance.now(), last: 0, observer: null, timer: 0 };
      const expire = () => {
        clearTimeout(watch.timer);
        watch.timer = setTimeout(() => { if (reactionWatch === watch) api.unwatchReaction(); }, 3000);
      };
      watch.onInput = () => { watch.lastInput = performance.now(); expire(); };
      field.addEventListener("input", watch.onInput, true);
      field.addEventListener("keydown", watch.onInput, true);
      const results = api.popupIds(field).map((name) => document.getElementById(name)).filter(Boolean);
      const relevant = (record) => !field.contains(record.target)
        && (!results.length || results.some((node) => !node.isConnected || node === record.target || node.contains(record.target)));
      watch.observer = new MutationObserver((records) => {
        if (records.some(relevant)) watch.last = performance.now();
      });
      watch.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      expire();
      reactionWatch = watch;
      return true;
    },
    reactionState(id) {
      const watch = reactionWatch;
      if (!watch || watch.id !== id) return null;
      const now = performance.now();
      const busy = watch.field.getAttribute("aria-busy") === "true" || Boolean(document.querySelector("[aria-busy=true]"));
      return { sinceInput: now - watch.lastInput, sinceLast: watch.last > watch.lastInput ? now - watch.last : null, busy };
    },
    unwatchReaction(id) {
      const watch = reactionWatch;
      if (!watch || (id !== undefined && watch.id !== id)) return true;
      watch.observer.disconnect();
      clearTimeout(watch.timer);
      watch.field.removeEventListener("input", watch.onInput, true);
      watch.field.removeEventListener("keydown", watch.onInput, true);
      reactionWatch = null;
      return true;
    },
    usedOpenedList(el) {
      const watch = suggestionWatches.get(el);
      return Boolean(watch && watch.opened && !watch.ambiguous);
    },
    visibleListboxes(el) {
      return deep(el.ownerDocument).filter((node) => node.getAttribute && node.getAttribute("role") === "listbox" && api.visible(node));
    },
    openedList(el) {
      const watch = suggestionWatches.get(el);
      if (!watch || !watch.listsBefore) return null;
      const now = performance.now();
      if (watch.checkedAt && now - watch.checkedAt < 50 && (!watch.opened || watch.opened.isConnected && api.visible(watch.opened))) return watch.ambiguous ? null : watch.opened;
      watch.checkedAt = now;
      const fresh = api.visibleListboxes(el).filter((node) => !watch.listsBefore.has(node) && !api.ownerOf(node, el));
      watch.opened = fresh.length === 1 ? fresh[0] : null;
      if (fresh.length > 1) watch.ambiguous = true;
      return watch.ambiguous ? null : watch.opened;
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
      const linked = api.popupIds(el).length || el.getAttribute("aria-activedescendant") || api.componentOf(el);
      const watch = { lastInput: 0, lastChange: 0, observer: null, listsBefore: linked ? null : new Set(api.visibleListboxes(el)), opened: null };
      watch.signature = api.optionSignature(el);
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
