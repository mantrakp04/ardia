(() => {
  const $ = (id) => document.getElementById(id);
  const ROW_H = 34;
  const HEAD_H = 36;
  const OVERSCAN = 8;
  const ROWHEAD_W = 60;
  const COLUMNS = [
    { key: "sku", label: "SKU", width: 112, kind: "sku" },
    { key: "item", label: "Item", width: 330, kind: "text" },
    { key: "category", label: "Category", width: 170, kind: "list" },
    { key: "warehouse", label: "Warehouse", width: 132, kind: "list" },
    { key: "bin", label: "Bin", width: 82, kind: "bin" },
    { key: "on_hand", label: "On hand", width: 92, kind: "int" },
    { key: "reorder", label: "Reorder level", width: 114, kind: "int" },
    { key: "price_cents", label: "Unit price", width: 100, kind: "price" },
    { key: "status", label: "Status", width: 128, kind: "list" },
    { key: "supplier", label: "Supplier", width: 190, kind: "text" },
  ];
  const OFFSETS = COLUMNS.reduce((acc, col, i) => acc.concat(acc[i] + col.width), [0]);
  const TOTAL_W = ROWHEAD_W + OFFSETS[COLUMNS.length];
  const TEMPLATE = [ROWHEAD_W, ...COLUMNS.map((c) => c.width)].map((w) => w + "px").join(" ");
  const isNumeric = (col) => col.kind === "int" || col.kind === "price";

  const el = {
    grid: $("grid"), canvas: $("canvas"), headRow: $("head-row"), loading: $("loading"), quick: $("quick"),
    fWarehouse: $("f-warehouse"), fCategory: $("f-category"), fStatus: $("f-status"), clear: $("clear-filters"),
    count: $("count"), add: $("add-row"), save: $("save"), discard: $("discard"), saveState: $("save-state"),
    banner: $("banner"), position: $("position"), toast: $("toast"), dialog: $("discard-dialog"),
    discardSummary: $("discard-summary"), discardOk: $("discard-ok"), discardCancel: $("discard-cancel"),
  };

  const lists = { category: [], warehouse: [], status: [] };
  const state = {
    rows: [], byId: new Map(), pending: new Map(), drafts: [], nextDraft: 1, display: [], filteredCount: 0,
    sort: { key: "sku", dir: 1 }, filters: { quick: "", warehouse: "", category: "", status: "" },
    active: { r: 0, c: 0 }, editing: null, saving: false, savedOnce: false, invalid: new Set(),
    version: 0, rowVersion: new Map(), rendered: new Map(), activeCell: null, frame: 0,
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

  function value(item, key) {
    if (item.draft) return item.values[key] ?? "";
    const p = state.pending.get(item.row.id);
    return p && key in p ? p[key] : item.row[key];
  }

  function rowValue(row, key) {
    const p = state.pending.get(row.id);
    return p && key in p ? p[key] : row[key];
  }

  function isDirty(item, key) {
    if (item.draft) return false;
    const p = state.pending.get(item.row.id);
    return Boolean(p && key in p);
  }

  function display(col, v) {
    if (v === "" || v == null) return "";
    if (col.kind === "int") return Number(v).toLocaleString("en-US");
    if (col.kind === "price") return "$" + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return String(v);
  }

  function editText(col, v) {
    if (v === "" || v == null) return "";
    if (col.kind === "int") return String(v);
    if (col.kind === "price") return (v / 100).toFixed(2);
    return String(v);
  }

  function parse(col, text, isDraft) {
    const t = text.trim();
    const ok = (v) => ({ ok: true, value: v });
    const fail = (error) => ({ ok: false, error });
    if (t === "") {
      if (isDraft || col.kind === "bin") return ok("");
      return fail(`${col.label} can't be empty.`);
    }
    if (col.kind === "int") {
      const s = t.replace(/,/g, "");
      if (!/^\d+$/.test(s)) return fail(`${col.label} must be a whole number, like 120.`);
      const n = Number(s);
      return n > 1000000 ? fail(`${col.label} can't be more than 1,000,000.`) : ok(n);
    }
    if (col.kind === "price") {
      const s = t.replace(/^\$\s*/, "").replace(/,/g, "");
      if (!/^\d+(\.\d{1,2})?$/.test(s)) return fail("Unit price must be dollars and cents, like 12.50.");
      const cents = Math.round(Number(s) * 100);
      return cents <= 0 ? fail("Unit price must be more than $0.00.") : ok(cents);
    }
    if (col.kind === "list") {
      const match = lists[col.key].find((o) => o.toLowerCase() === t.toLowerCase());
      return match ? ok(match) : fail(`${col.label} must be one of: ${lists[col.key].join(", ")}.`);
    }
    if (col.kind === "sku") {
      const u = t.toUpperCase();
      return /^[A-Z]{3}-\d{5}$/.test(u) ? ok(u) : fail("SKU must be three letters, a dash and five digits, like FAS-10234.");
    }
    if (col.kind === "bin") {
      const u = t.toUpperCase();
      return /^[A-Z]-\d{2}-\d$/.test(u) ? ok(u) : fail("Bin must be aisle-bay-shelf, like C-14-2.");
    }
    const s = t.replace(/\s+/g, " ");
    return s.length > 80 ? fail(`${col.label} can be at most 80 characters.`) : ok(s);
  }

  function pendingCount() {
    let n = state.drafts.length;
    for (const p of state.pending.values()) n += Object.keys(p).length;
    return n;
  }

  function updateChrome() {
    const n = pendingCount();
    el.save.disabled = n === 0 || state.saving;
    el.discard.disabled = n === 0 || state.saving;
    el.save.textContent = state.saving ? "Saving…" : "Save";
    if (state.saving) {
      el.saveState.textContent = "Saving…";
      el.saveState.className = "save-state";
    } else if (n) {
      el.saveState.textContent = plural(n, "unsaved change", "unsaved changes");
      el.saveState.className = "save-state dirty";
    } else {
      el.saveState.textContent = state.savedOnce ? "All changes saved" : "Up to date";
      el.saveState.className = "save-state";
    }
    const f = state.filters;
    const filtered = Boolean(f.quick.trim() || f.warehouse || f.category || f.status);
    el.clear.hidden = !filtered;
    el.count.textContent = filtered
      ? `${state.filteredCount.toLocaleString("en-US")} of ${plural(state.rows.length, "row", "rows")}`
      : plural(state.rows.length, "row", "rows");
    const col = COLUMNS[state.active.c];
    el.position.textContent = state.display.length ? `Row ${state.active.r + 1} of ${state.display.length.toLocaleString("en-US")} · ${col.label}` : "No rows match";
  }

  function recompute() {
    const f = state.filters;
    const q = f.quick.trim().toLowerCase();
    const rows = state.rows.filter((row) => {
      if (f.warehouse && rowValue(row, "warehouse") !== f.warehouse) return false;
      if (f.category && rowValue(row, "category") !== f.category) return false;
      if (f.status && rowValue(row, "status") !== f.status) return false;
      if (!q) return true;
      const hay = ["sku", "item", "category", "warehouse", "bin", "status", "supplier"].map((k) => rowValue(row, k)).join(" ").toLowerCase();
      return hay.includes(q);
    });
    const col = COLUMNS.find((c) => c.key === state.sort.key);
    const dir = state.sort.dir;
    rows.sort((a, b) => {
      const va = rowValue(a, col.key);
      const vb = rowValue(b, col.key);
      const cmp = isNumeric(col) ? va - vb : String(va).localeCompare(String(vb), "en", { numeric: true, sensitivity: "base" });
      return cmp * dir || a.id - b.id;
    });
    state.filteredCount = rows.length;
    state.display = state.drafts.concat(rows.map((row) => ({ draft: false, key: String(row.id), row })));
    state.version++;
    state.active.r = Math.min(state.active.r, Math.max(0, state.display.length - 1));
  }

  function renderHead() {
    const cells = [`<div class="cell rowhead" role="columnheader" aria-colindex="1"><span class="sr">Row</span></div>`];
    COLUMNS.forEach((col, i) => {
      const sorted = state.sort.key === col.key;
      const aria = sorted ? (state.sort.dir === 1 ? "ascending" : "descending") : "none";
      const arrow = sorted ? (state.sort.dir === 1 ? "▲" : "▼") : "";
      cells.push(`<div class="cell${isNumeric(col) ? " num" : ""}" role="columnheader" aria-colindex="${i + 2}" aria-sort="${aria}">` +
        `<button type="button" class="sort" data-key="${col.key}">${escapeHtml(col.label)}<span class="arrow" aria-hidden="true">${arrow}</span></button></div>`);
    });
    el.headRow.innerHTML = cells.join("");
    el.headRow.style.gridTemplateColumns = TEMPLATE;
    el.headRow.style.width = TOTAL_W + "px";
  }

  function cellId(item, col) {
    return `c-${item.key}-${col.key}`;
  }

  function cellHtml(item, col, i) {
    const v = value(item, col.key);
    const classes = ["cell"];
    if (isNumeric(col)) classes.push("num");
    if (isDirty(item, col.key)) classes.push("dirty");
    if (state.invalid.has(`${item.key}:${col.key}`)) classes.push("invalid");
    let inner = escapeHtml(display(col, v));
    if (col.key === "status" && v) inner = `<span class="status-pill ${escapeHtml(String(v).replace(/\s+/g, "-"))}">${inner}</span>`;
    else if (col.key === "on_hand" && v !== "" && Number(v) < Number(value(item, "reorder"))) inner = `<span class="low" title="Below reorder level">${inner}</span>`;
    else inner = `<span>${inner}</span>`;
    const title = isDirty(item, col.key) ? ` title="Edited, not saved yet"` : "";
    return `<div role="gridcell" id="${cellId(item, col)}" aria-colindex="${i + 2}" class="${classes.join(" ")}" data-c="${i}"${title}>${inner}</div>`;
  }

  function buildRow(item, r) {
    const node = document.createElement("div");
    node.className = "row" + (item.draft ? " draft" : "");
    node.setAttribute("role", "row");
    node.setAttribute("aria-rowindex", String(r + 2));
    node.dataset.r = String(r);
    node.style.top = r * ROW_H + "px";
    node.style.gridTemplateColumns = TEMPLATE;
    node.style.width = TOTAL_W + "px";
    const head = item.draft
      ? `<div class="cell rowhead" role="gridcell" aria-colindex="1">New<button type="button" class="remove-draft" data-remove="${item.key}" aria-label="Remove new row">✕</button></div>`
      : `<div class="cell rowhead" role="gridcell" aria-colindex="1">${r + 1 - state.drafts.length}</div>`;
    node.innerHTML = head + COLUMNS.map((col, i) => cellHtml(item, col, i)).join("");
    return node;
  }

  function renderRows() {
    const total = state.display.length;
    el.canvas.style.height = total * ROW_H + "px";
    el.canvas.style.width = TOTAL_W + "px";
    el.grid.setAttribute("aria-rowcount", String(total + 1));
    el.grid.setAttribute("aria-colcount", String(COLUMNS.length + 1));
    const top = el.grid.scrollTop;
    const height = Math.max(0, el.grid.clientHeight - HEAD_H);
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const last = Math.min(total - 1, Math.ceil((top + height) / ROW_H) + OVERSCAN);
    const keep = new Set();
    let prev = null;
    for (let r = first; r <= last; r++) {
      const item = state.display[r];
      const sig = `${r}|${state.version}|${state.rowVersion.get(item.key) || 0}`;
      let node = state.rendered.get(item.key);
      if (!node || node.dataset.sig !== sig) {
        const fresh = buildRow(item, r);
        fresh.dataset.sig = sig;
        if (node) node.replaceWith(fresh);
        node = fresh;
        state.rendered.set(item.key, node);
      }
      const expected = prev ? prev.nextSibling : el.canvas.firstChild;
      if (node !== expected) el.canvas.insertBefore(node, expected);
      prev = node;
      keep.add(item.key);
    }
    for (const [key, node] of state.rendered) {
      if (!keep.has(key)) {
        node.remove();
        state.rendered.delete(key);
      }
    }
    syncActive();
    updateChrome();
  }

  function scheduleRender() {
    if (state.frame) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      renderRows();
    });
  }

  function syncActive() {
    const item = state.display[state.active.r];
    const id = item ? cellId(item, COLUMNS[state.active.c]) : "";
    const cell = id ? document.getElementById(id) : null;
    if (state.activeCell && state.activeCell !== cell) {
      state.activeCell.classList.remove("active");
      state.activeCell.removeAttribute("aria-selected");
    }
    if (cell) {
      cell.classList.add("active");
      cell.setAttribute("aria-selected", "true");
      el.grid.setAttribute("aria-activedescendant", id);
    } else {
      el.grid.removeAttribute("aria-activedescendant");
    }
    state.activeCell = cell;
  }

  function setActive(r, c) {
    state.active = { r: Math.max(0, Math.min(r, state.display.length - 1)), c: Math.max(0, Math.min(c, COLUMNS.length - 1)) };
    revealActive();
    syncActive();
    updateChrome();
  }

  function revealActive() {
    const { r, c } = state.active;
    const g = el.grid;
    const rowTop = r * ROW_H;
    const viewH = g.clientHeight - HEAD_H;
    if (rowTop < g.scrollTop) g.scrollTop = rowTop;
    else if (rowTop + ROW_H > g.scrollTop + viewH) g.scrollTop = rowTop + ROW_H - viewH;
    const left = ROWHEAD_W + OFFSETS[c];
    const right = left + COLUMNS[c].width;
    if (left - ROWHEAD_W < g.scrollLeft) g.scrollLeft = left - ROWHEAD_W;
    else if (right > g.scrollLeft + g.clientWidth) g.scrollLeft = right - g.clientWidth;
    renderRows();
  }

  function bumpRow(key) {
    state.rowVersion.set(key, (state.rowVersion.get(key) || 0) + 1);
  }

  function apply(item, field, v) {
    if (item.draft) {
      item.values[field] = v;
    } else {
      const original = item.row[field];
      const p = state.pending.get(item.row.id) || {};
      if (v === original) delete p[field];
      else p[field] = v;
      if (Object.keys(p).length) state.pending.set(item.row.id, p);
      else state.pending.delete(item.row.id);
    }
    state.invalid.delete(`${item.key}:${field}`);
    bumpRow(item.key);
  }

  function startEdit(initial) {
    if (state.editing || state.saving) return;
    const { r, c } = state.active;
    const item = state.display[r];
    if (!item) return;
    const col = COLUMNS[c];
    revealActive();
    const input = document.createElement("input");
    input.className = "editor";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${col.label}, ${item.draft ? "new row" : item.row.sku + " " + value(item, "warehouse")}`);
    if (col.kind === "list") input.setAttribute("list", `list-${col.key}`);
    if (isNumeric(col)) input.inputMode = "decimal";
    input.value = initial ?? editText(col, value(item, col.key));
    input.style.top = HEAD_H + r * ROW_H + "px";
    input.style.left = ROWHEAD_W + OFFSETS[c] + "px";
    input.style.width = Math.max(col.width, col.kind === "list" ? 190 : 120) + "px";
    if (isNumeric(col)) input.style.textAlign = "right";
    state.editing = { input, item, col, r, c, error: null };
    el.grid.appendChild(input);
    input.focus();
    if (initial == null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener("keydown", onEditorKey);
    input.addEventListener("input", () => clearEditorError());
    input.addEventListener("blur", () => {
      if (state.editing && state.editing.input === input) commit(true);
    });
  }

  function clearEditorError() {
    const ed = state.editing;
    if (!ed || !ed.error) return;
    ed.error.remove();
    ed.error = null;
    ed.input.removeAttribute("aria-invalid");
    ed.input.removeAttribute("aria-describedby");
  }

  function showEditorError(text) {
    const ed = state.editing;
    clearEditorError();
    const tip = document.createElement("div");
    tip.className = "cell-error";
    tip.id = "cell-error";
    tip.setAttribute("role", "alert");
    tip.textContent = text;
    const below = (ed.r + 1) * ROW_H + 44 <= el.grid.scrollTop + el.grid.clientHeight - HEAD_H;
    tip.style.top = (below ? HEAD_H + (ed.r + 1) * ROW_H + 4 : HEAD_H + ed.r * ROW_H - 40) + "px";
    tip.style.left = ROWHEAD_W + OFFSETS[ed.c] + "px";
    el.grid.appendChild(tip);
    ed.error = tip;
    ed.input.setAttribute("aria-invalid", "true");
    ed.input.setAttribute("aria-describedby", "cell-error");
  }

  function closeEditor() {
    const ed = state.editing;
    if (!ed) return;
    state.editing = null;
    if (ed.error) ed.error.remove();
    ed.input.remove();
  }

  function commit(fromBlur) {
    const ed = state.editing;
    if (!ed) return true;
    const res = parse(ed.col, ed.input.value, ed.item.draft);
    if (!res.ok) {
      if (fromBlur) {
        closeEditor();
        toast(`Change not applied. ${res.error}`);
        renderRows();
        return false;
      }
      showEditorError(res.error);
      ed.input.focus();
      return false;
    }
    apply(ed.item, ed.col.key, res.value);
    closeEditor();
    renderRows();
    return true;
  }

  function cancelEdit() {
    closeEditor();
    el.grid.focus();
    renderRows();
  }

  function onEditorKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (commit(false)) {
        el.grid.focus();
        setActive(state.active.r + (e.shiftKey ? -1 : 1), state.active.c);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (commit(false)) {
        el.grid.focus();
        moveHorizontal(e.shiftKey ? -1 : 1);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
  }

  function moveHorizontal(step) {
    let { r, c } = state.active;
    c += step;
    if (c >= COLUMNS.length) { c = 0; r = Math.min(r + 1, state.display.length - 1); }
    if (c < 0) { c = COLUMNS.length - 1; r = Math.max(r - 1, 0); }
    setActive(r, c);
  }

  function onGridKey(e) {
    if (e.target !== el.grid || !state.display.length) return;
    const { r, c } = state.active;
    const page = Math.max(1, Math.floor((el.grid.clientHeight - HEAD_H) / ROW_H) - 1);
    const mod = e.metaKey || e.ctrlKey;
    const moves = {
      ArrowDown: () => setActive(mod ? state.display.length - 1 : r + 1, c),
      ArrowUp: () => setActive(mod ? 0 : r - 1, c),
      ArrowRight: () => setActive(r, mod ? COLUMNS.length - 1 : c + 1),
      ArrowLeft: () => setActive(r, mod ? 0 : c - 1),
      PageDown: () => setActive(r + page, c),
      PageUp: () => setActive(r - page, c),
      Home: () => setActive(mod ? 0 : r, 0),
      End: () => setActive(mod ? state.display.length - 1 : r, COLUMNS.length - 1),
      Enter: () => startEdit(),
      F2: () => startEdit(),
      Backspace: () => startEdit(""),
      Delete: () => startEdit(""),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
      return;
    }
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(e.key);
    }
  }

  function locate(target) {
    const cell = target.closest(".cell[data-c]");
    const row = target.closest(".row[data-r]");
    return cell && row ? { r: Number(row.dataset.r), c: Number(cell.dataset.c) } : null;
  }

  function addRow() {
    if (state.editing && !commit(false)) return;
    const draft = { draft: true, key: `n${state.nextDraft++}`, values: {} };
    state.drafts.unshift(draft);
    recompute();
    el.grid.scrollTop = 0;
    el.grid.scrollLeft = 0;
    state.active = { r: 0, c: 0 };
    renderRows();
    el.grid.focus();
    startEdit();
  }

  function removeDraft(key) {
    if (state.editing && state.editing.item.key === key) closeEditor();
    state.drafts = state.drafts.filter((d) => d.key !== key);
    for (const k of [...state.invalid]) if (k.startsWith(key + ":")) state.invalid.delete(k);
    recompute();
    renderRows();
    el.grid.focus();
  }

  function describeRow(id) {
    const row = state.byId.get(id);
    return row ? `${row.sku} (${row.warehouse})` : "A row";
  }

  function showBanner(lines) {
    el.banner.textContent = lines.join("\n");
    el.banner.hidden = false;
  }

  function hideBanner() {
    el.banner.hidden = true;
    el.banner.textContent = "";
  }

  async function save() {
    if (state.saving) return;
    if (state.editing && !commit(false)) return;
    if (!pendingCount()) return;
    state.invalid.clear();
    state.version++;
    const missing = [];
    state.drafts.forEach((d, i) => {
      const empty = COLUMNS.filter((col) => col.kind !== "bin" && (d.values[col.key] === "" || d.values[col.key] == null));
      empty.forEach((col) => state.invalid.add(`${d.key}:${col.key}`));
      if (empty.length) missing.push(`New row ${i + 1} is missing ${empty.map((col) => col.label).join(", ")}.`);
      bumpRow(d.key);
    });
    if (missing.length) {
      showBanner(["Fill in the new row before saving.", ...missing]);
      renderRows();
      return;
    }
    const changes = [];
    for (const [id, p] of state.pending) for (const [field, v] of Object.entries(p)) changes.push({ id, field, value: v });
    const draftsSent = state.drafts.slice();
    const newRows = draftsSent.map((d) => Object.fromEntries(COLUMNS.map((col) => [col.key, d.values[col.key] ?? ""])));
    const total = changes.length + newRows.length;
    state.saving = true;
    updateChrome();
    try {
      const res = await fetch("/api/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes, new_rows: newRows }) });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const lines = ["Nothing was saved. Fix these and try again:"];
        for (const err of (data && data.errors) || []) {
          if (err.change != null && changes[err.change]) {
            const ch = changes[err.change];
            const col = COLUMNS.find((x) => x.key === ch.field);
            state.invalid.add(`${ch.id}:${ch.field}`);
            bumpRow(String(ch.id));
            lines.push(`${describeRow(ch.id)} · ${col ? col.label : ch.field}: ${err.error}`);
          } else if (err.new_row != null && draftsSent[err.new_row]) {
            const col = COLUMNS.find((x) => x.key === err.field);
            state.invalid.add(`${draftsSent[err.new_row].key}:${err.field}`);
            bumpRow(draftsSent[err.new_row].key);
            lines.push(`New row ${err.new_row + 1} · ${col ? col.label : err.field}: ${err.error}`);
          } else {
            lines.push(err.error || "Something went wrong.");
          }
        }
        if (lines.length === 1) lines.push((data && data.error) || `The server answered ${res.status}.`);
        showBanner(lines);
        return;
      }
      for (const u of data.updated) Object.assign(state.byId.get(u.id), u);
      for (const a of data.added) {
        state.rows.push(a);
        state.byId.set(a.id, a);
      }
      state.pending.clear();
      state.drafts = [];
      state.savedOnce = true;
      hideBanner();
      recompute();
      toast(`Saved ${plural(total, "change", "changes")}.`);
    } catch {
      showBanner(["Couldn't reach Stockroom. Your changes are still here; try saving again."]);
    } finally {
      state.saving = false;
      renderRows();
    }
  }

  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 4000);
  }

  function setFilter(key, v) {
    if (state.editing && !commit(true)) renderRows();
    state.filters[key] = v;
    recompute();
    el.grid.scrollTop = 0;
    state.active.r = 0;
    renderRows();
  }

  function fillOptions(select, datalist, options) {
    for (const o of options) {
      select.append(new Option(o, o));
      const opt = document.createElement("option");
      opt.value = o;
      datalist.append(opt);
    }
  }

  let quickTimer = 0;
  el.quick.addEventListener("input", () => {
    clearTimeout(quickTimer);
    quickTimer = setTimeout(() => setFilter("quick", el.quick.value), 150);
  });
  el.fWarehouse.addEventListener("change", () => setFilter("warehouse", el.fWarehouse.value));
  el.fCategory.addEventListener("change", () => setFilter("category", el.fCategory.value));
  el.fStatus.addEventListener("change", () => setFilter("status", el.fStatus.value));
  el.clear.addEventListener("click", () => {
    el.quick.value = "";
    el.fWarehouse.value = "";
    el.fCategory.value = "";
    el.fStatus.value = "";
    Object.assign(state.filters, { quick: "", warehouse: "", category: "", status: "" });
    recompute();
    el.grid.scrollTop = 0;
    renderRows();
  });

  el.headRow.addEventListener("click", (e) => {
    const btn = e.target.closest("button.sort");
    if (!btn) return;
    if (state.editing && !commit(true)) renderRows();
    const key = btn.dataset.key;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: 1 };
    renderHead();
    recompute();
    el.grid.scrollTop = 0;
    state.active.r = 0;
    renderRows();
  });

  el.grid.addEventListener("scroll", scheduleRender, { passive: true });
  el.grid.addEventListener("keydown", onGridKey);
  el.canvas.addEventListener("mousedown", (e) => {
    if (e.target.closest(".remove-draft")) return;
    const at = locate(e.target);
    if (at) setActive(at.r, at.c);
  });
  el.canvas.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-draft");
    if (btn) removeDraft(btn.dataset.remove);
  });
  el.canvas.addEventListener("dblclick", (e) => {
    const at = locate(e.target);
    if (!at) return;
    setActive(at.r, at.c);
    startEdit();
  });
  window.addEventListener("resize", scheduleRender);

  el.add.addEventListener("click", addRow);
  el.save.addEventListener("click", save);
  el.discard.addEventListener("click", () => {
    if (state.editing && !commit(true)) renderRows();
    el.discardSummary.textContent = `You have ${plural(pendingCount(), "unsaved change", "unsaved changes")}. They'll be lost.`;
    el.dialog.showModal();
  });
  el.discardCancel.addEventListener("click", () => el.dialog.close());
  el.discardOk.addEventListener("click", () => {
    el.dialog.close();
    state.pending.clear();
    state.drafts = [];
    state.invalid.clear();
    hideBanner();
    recompute();
    renderRows();
    toast("Changes discarded.");
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (pendingCount()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  async function load() {
    renderHead();
    try {
      const res = await fetch("/api/rows");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      lists.category = data.categories;
      lists.warehouse = data.warehouses;
      lists.status = data.statuses;
      fillOptions(el.fWarehouse, $("list-warehouse"), data.warehouses);
      fillOptions(el.fCategory, $("list-category"), data.categories);
      fillOptions(el.fStatus, $("list-status"), data.statuses);
      state.rows = data.rows;
      state.byId = new Map(data.rows.map((r) => [r.id, r]));
      state.savedOnce = Boolean(data.saved_at_ms);
      recompute();
      el.loading.hidden = true;
      el.add.disabled = false;
      renderRows();
    } catch {
      el.loading.textContent = "Couldn't load inventory. Reload the page to try again.";
    }
  }

  load();
})();
