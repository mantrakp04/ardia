import { request } from "../../../realism.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const MAX_DIGITS = 9;

  const el = {
    lines: $("lines"), total: $("total"), add: $("add-line"), submit: $("submit-report"), banner: $("banner"),
    chip: $("status-chip"), saveState: $("save-state"), live: $("live"), toast: $("toast"),
    panel: $("panel"), scrim: $("scrim"), form: $("line-form"), panelTitle: $("panel-title"),
    merchant: $("merchant"), category: $("category"), amount: $("amount"),
    dateDisplay: $("date-display"), dateToggle: $("date-toggle"), calendar: $("calendar"), calTitle: $("cal-title"),
    calBody: $("cal-body"), calPrev: $("cal-prev"), calNext: $("cal-next"),
    confirm: $("confirm"), modalScrim: $("modal-scrim"), confirmInput: $("confirm-input"), confirmOk: $("confirm-ok"),
    confirmCancel: $("confirm-cancel"), confirmSummary: $("confirm-summary"), confirmError: $("confirm-error"),
  };

  const state = { lines: [], status: "draft", reference: null, today: "2026-11-06", editingId: null, date: null, view: null, cents: 0, dragId: null, intent: null };

  const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parts = (s) => s.split("-").map(Number);
  const shortDate = (s) => {
    const [y, m, d] = parts(s);
    return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
  };
  const longDate = (s) => {
    const [y, m, d] = parts(s);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  };

  async function api(method, path, body) {
    const r = await request(path, { method, body: body || undefined });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) throw Object.assign(new Error((data && data.error) || `Request failed (${r.status})`), { status: r.status });
    return data;
  }

  let toastTimer = 0;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3500);
  }

  function announce(text) {
    el.live.textContent = "";
    setTimeout(() => { el.live.textContent = text; }, 30);
  }

  function markSaved() {
    el.saveState.textContent = "All changes saved";
  }

  function render() {
    const locked = state.status === "submitted";
    el.chip.textContent = locked ? "Submitted" : "Draft";
    el.chip.className = "chip" + (locked ? " submitted" : "");
    el.add.disabled = locked;
    el.submit.disabled = locked;
    el.lines.replaceChildren();
    if (!state.lines.length) {
      const tr = document.createElement("tr");
      tr.className = "empty";
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "No lines yet. Add one for each purchase.";
      tr.append(td);
      el.lines.append(tr);
    }
    state.lines.forEach((line, i) => {
      const tr = document.createElement("tr");
      tr.dataset.id = line.id;
      const tdHandle = document.createElement("td");
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "handle";
      handle.textContent = "⠿";
      handle.draggable = !locked;
      handle.disabled = locked;
      handle.dataset.id = line.id;
      handle.setAttribute("aria-roledescription", "sortable");
      handle.setAttribute("aria-label", `Reorder ${line.merchant}, line ${i + 1} of ${state.lines.length}`);
      handle.addEventListener("dragstart", onDragStart);
      handle.addEventListener("dragend", onDragEnd);
      tdHandle.append(handle);
      const cells = [line.merchant, shortDate(line.date), line.category, money(line.amount_cents)].map((t, k) => {
        const td = document.createElement("td");
        td.textContent = t;
        if (k === 3) td.className = "num";
        return td;
      });
      const tdAct = document.createElement("td");
      tdAct.className = "row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn link";
      edit.textContent = "Edit";
      edit.disabled = locked;
      edit.setAttribute("aria-label", `Edit ${line.merchant}`);
      edit.addEventListener("click", () => openPanel(line.id));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn link danger";
      del.textContent = "Delete";
      del.disabled = locked;
      del.setAttribute("aria-label", `Delete ${line.merchant}`);
      del.addEventListener("click", () => deleteLine(line.id));
      tdAct.append(edit, del);
      tr.append(tdHandle, ...cells, tdAct);
      el.lines.append(tr);
    });
    el.total.textContent = money(state.lines.reduce((s, l) => s + l.amount_cents, 0));
  }

  async function saveOrder() {
    try {
      await api("POST", "/api/lines/order", { ids: state.lines.map((l) => l.id) });
      markSaved();
    } catch (e) {
      toast(e.message);
      await load();
    }
  }

  function moveLine(id, to) {
    const from = state.lines.findIndex((l) => l.id === id);
    if (from < 0 || to < 0 || to >= state.lines.length || from === to) return false;
    const [line] = state.lines.splice(from, 1);
    state.lines.splice(to, 0, line);
    render();
    announce(`${line.merchant} moved to position ${to + 1} of ${state.lines.length}.`);
    saveOrder();
    return true;
  }

  function onHandleKey(e) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const id = e.currentTarget.dataset.id;
    const from = state.lines.findIndex((l) => l.id === id);
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (!moveLine(id, to)) {
      announce(`${state.lines[from].merchant} is already ${to < 0 ? "first" : "last"}.`);
      return;
    }
    const h = el.lines.querySelector(`.handle[data-id="${id}"]`);
    if (h) h.focus();
  }

  function clearDropMarks() {
    for (const tr of el.lines.querySelectorAll("tr")) tr.classList.remove("drop-before", "drop-after", "dragging");
  }

  function onDragStart(e) {
    state.dragId = e.currentTarget.dataset.id;
    const tr = e.currentTarget.closest("tr");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", state.dragId);
    try { e.dataTransfer.setDragImage(tr, 20, 20); } catch {}
    requestAnimationFrame(() => tr.classList.add("dragging"));
  }

  function onDragEnd() {
    state.dragId = null;
    clearDropMarks();
  }

  function dropTarget(e) {
    const tr = e.target.closest && e.target.closest("tr[data-id]");
    if (!tr) return null;
    const r = tr.getBoundingClientRect();
    return { tr, after: e.clientY > r.top + r.height / 2 };
  }

  el.lines.addEventListener("dragover", (e) => {
    if (!state.dragId) return;
    const t = dropTarget(e);
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    for (const tr of el.lines.querySelectorAll("tr")) tr.classList.remove("drop-before", "drop-after");
    t.tr.classList.add(t.after ? "drop-after" : "drop-before");
  });

  el.lines.addEventListener("drop", (e) => {
    const id = state.dragId || e.dataTransfer.getData("text/plain");
    const t = dropTarget(e);
    clearDropMarks();
    if (!id || !t) return;
    e.preventDefault();
    const from = state.lines.findIndex((l) => l.id === id);
    let to = state.lines.findIndex((l) => l.id === t.tr.dataset.id) + (t.after ? 1 : 0);
    if (from < to) to -= 1;
    moveLine(id, to);
    state.dragId = null;
  });

  async function deleteLine(id) {
    const line = state.lines.find((l) => l.id === id);
    if (!line) return;
    try {
      await api("DELETE", `/api/lines/${id}`);
      state.lines = state.lines.filter((l) => l.id !== id);
      render();
      markSaved();
      toast(`Deleted ${line.merchant}`);
      announce(`Deleted ${line.merchant}.`);
    } catch (e) {
      toast(e.message);
    }
  }

  function setDate(value) {
    state.date = value;
    el.dateDisplay.textContent = value ? longDate(value) : "No date selected";
    el.dateDisplay.classList.toggle("placeholder", !value);
    el.dateToggle.setAttribute("aria-label", value ? `Choose date, selected ${longDate(value)}` : "Choose date");
  }

  function renderCalendar() {
    const { y, m } = state.view;
    el.calTitle.textContent = `${MONTHS[m]} ${y}`;
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    el.calBody.replaceChildren();
    let tr = document.createElement("tr");
    for (let i = 0; i < first; i++) tr.append(document.createElement("td"));
    for (let d = 1; d <= days; d++) {
      if (tr.children.length === 7) {
        el.calBody.append(tr);
        tr = document.createElement("tr");
      }
      const td = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      const value = ymd(y, m, d);
      b.textContent = String(d);
      b.dataset.date = value;
      b.setAttribute("aria-label", longDate(value));
      b.setAttribute("aria-pressed", value === state.date ? "true" : "false");
      if (value === state.today) b.classList.add("today");
      b.tabIndex = value === state.date || (!state.date && d === 1) ? 0 : -1;
      b.addEventListener("click", () => {
        setDate(value);
        closeCalendar(true);
      });
      td.append(b);
      tr.append(td);
    }
    while (tr.children.length < 7) tr.append(document.createElement("td"));
    el.calBody.append(tr);
  }

  function openCalendar() {
    const base = state.date || state.today;
    const [y, m] = parts(base);
    state.view = { y, m: m - 1 };
    renderCalendar();
    el.calendar.hidden = false;
    el.dateToggle.setAttribute("aria-expanded", "true");
    const focusable = el.calBody.querySelector('.day[tabindex="0"]');
    if (focusable) focusable.focus();
    document.addEventListener("mousedown", outsideCalendar, true);
  }

  function closeCalendar(refocus) {
    if (el.calendar.hidden) return;
    el.calendar.hidden = true;
    el.dateToggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outsideCalendar, true);
    if (refocus) el.dateToggle.focus();
  }

  function outsideCalendar(e) {
    if (!el.calendar.contains(e.target) && e.target !== el.dateToggle) closeCalendar(false);
  }

  function shiftMonth(delta) {
    let { y, m } = state.view;
    m += delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    state.view = { y, m };
    renderCalendar();
  }

  el.dateToggle.addEventListener("click", () => (el.calendar.hidden ? openCalendar() : closeCalendar(true)));
  el.calPrev.addEventListener("click", () => shiftMonth(-1));
  el.calNext.addEventListener("click", () => shiftMonth(1));
  el.calendar.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCalendar(true);
      return;
    }
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in steps) || !e.target.classList.contains("day")) return;
    e.preventDefault();
    const [y, m, d] = parts(e.target.dataset.date);
    const next = new Date(y, m - 1, d + steps[e.key]);
    if (next.getMonth() !== m - 1) shiftMonth(next < new Date(y, m - 1, 1) ? -1 : 1);
    const b = el.calBody.querySelector(`.day[data-date="${ymd(next.getFullYear(), next.getMonth(), next.getDate())}"]`);
    if (b) b.focus();
  });

  function parseDecimal(s) {
    const t = String(s).replace(/[$,\s]/g, "");
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(parseFloat(t) * 100);
  }

  function showAmount() {
    el.amount.value = state.cents ? money(state.cents) : "";
  }

  function centsFromDigits(v) {
    const digits = v.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_DIGITS);
    return digits ? parseInt(digits, 10) : 0;
  }

  el.amount.addEventListener("input", (e) => {
    const v = el.amount.value;
    const type = e.inputType;
    const typed = typeof type === "string" && (type.startsWith("delete") || (type.startsWith("insert") && type !== "insertFromPaste" && type !== "insertFromDrop"));
    const multi = typed && type.startsWith("insert") && e.data && e.data.length > 1 && parseDecimal(e.data) !== null && /[.,]/.test(e.data);
    if (!v.trim()) state.cents = 0;
    else if (multi) state.cents = parseDecimal(e.data);
    else if (typed) state.cents = centsFromDigits(v);
    else state.cents = parseDecimal(v) ?? centsFromDigits(v);
    showAmount();
    const end = el.amount.value.length;
    el.amount.setSelectionRange(end, end);
    $("err-amount").textContent = "";
  });

  function reconcileAmount() {
    if (el.amount.value === (state.cents ? money(state.cents) : "")) return true;
    const parsed = parseDecimal(el.amount.value);
    if (parsed === null) {
      $("err-amount").textContent = "Enter an amount like 63.27.";
      showAmount();
      return false;
    }
    state.cents = parsed;
    showAmount();
    return true;
  }

  el.amount.addEventListener("blur", reconcileAmount);
  el.amount.addEventListener("focus", () => {
    const end = el.amount.value.length;
    requestAnimationFrame(() => el.amount.setSelectionRange(end, end));
  });

  function clearErrors() {
    for (const id of ["err-merchant", "err-date", "err-category", "err-amount"]) $(id).textContent = "";
  }

  function openPanel(id) {
    if (state.status === "submitted") return;
    const line = id ? state.lines.find((l) => l.id === id) : null;
    state.editingId = line ? line.id : null;
    el.panelTitle.textContent = line ? "Edit line" : "Add line";
    el.panel.setAttribute("aria-labelledby", "panel-title");
    el.merchant.value = line ? line.merchant : "";
    setDate(line ? line.date : null);
    el.category.value = line ? line.category : "";
    state.cents = line ? line.amount_cents : 0;
    showAmount();
    clearErrors();
    closeCalendar(false);
    el.panel.hidden = false;
    el.scrim.hidden = false;
    el.merchant.focus();
  }

  function closePanel() {
    closeCalendar(false);
    el.category.close && el.category.close(false);
    el.panel.hidden = true;
    el.scrim.hidden = true;
    state.editingId = null;
    el.add.focus();
  }

  el.add.addEventListener("click", () => openPanel(null));
  $("panel-close").addEventListener("click", closePanel);
  $("panel-cancel").addEventListener("click", closePanel);
  el.panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.calendar.hidden) closePanel();
  });

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();
    const amountOk = reconcileAmount();
    const merchant = el.merchant.value.trim();
    const category = el.category.value;
    let ok = amountOk;
    if (!merchant) { $("err-merchant").textContent = "Enter the merchant."; ok = false; }
    if (!state.date) { $("err-date").textContent = "Choose the purchase date."; ok = false; }
    if (!category) { $("err-category").textContent = "Choose a category."; ok = false; }
    if (amountOk && state.cents <= 0) { $("err-amount").textContent = "Enter an amount greater than $0.00."; ok = false; }
    if (!ok) return;
    const payload = { merchant, date: state.date, category, amount_cents: state.cents };
    const btn = $("save-line");
    btn.disabled = true;
    try {
      if (state.editingId) {
        const saved = await api("PUT", `/api/lines/${state.editingId}`, payload);
        state.lines = state.lines.map((l) => (l.id === saved.id ? saved : l));
      } else {
        const saved = await api("POST", "/api/lines", payload);
        state.lines.push(saved);
      }
      render();
      markSaved();
      toast(`Saved ${merchant}`);
      closePanel();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  function requestIntent() {
    const pending = api("POST", "/api/submit/intent", { report: "rpt_2026_10" }).then((r) => r.intent);
    state.intent = pending;
    pending.catch(() => { if (state.intent === pending) state.intent = null; });
  }

  function openConfirm() {
    if (!state.lines.length) {
      showBanner("Add at least one line before submitting.", true);
      return;
    }
    requestIntent();
    const total = state.lines.reduce((s, l) => s + l.amount_cents, 0);
    el.confirmSummary.textContent = `${state.lines.length} line${state.lines.length === 1 ? "" : "s"}, ${money(total)} total, to Finance for approval.`;
    el.confirmInput.value = "";
    el.confirmOk.disabled = true;
    el.confirmError.textContent = "";
    el.confirm.hidden = false;
    el.modalScrim.hidden = false;
    el.confirmInput.focus();
  }

  function closeConfirm() {
    el.confirm.hidden = true;
    el.modalScrim.hidden = true;
    el.submit.focus();
  }

  function showBanner(text, error) {
    el.banner.textContent = text;
    el.banner.className = "banner" + (error ? " error" : "");
    el.banner.hidden = false;
  }

  el.submit.addEventListener("click", openConfirm);
  el.confirmCancel.addEventListener("click", closeConfirm);
  el.confirm.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeConfirm();
    if (e.key === "Enter" && !el.confirmOk.disabled) submitReport();
  });
  el.confirmInput.addEventListener("input", () => {
    el.confirmOk.disabled = el.confirmInput.value !== "SUBMIT";
  });
  async function submitReport() {
    if (el.confirmInput.value !== "SUBMIT") return;
    el.confirmOk.disabled = true;
    try {
      if (!state.intent) requestIntent();
      const intent = await state.intent;
      const lines = state.lines.map((l) => ({ id: l.id, merchant: l.merchant, date: l.date, category: l.category, amount_cents: l.amount_cents, amount: (l.amount_cents / 100).toFixed(2) }));
      const r = await api("POST", "/api/submit", { report: "rpt_2026_10", lines, intent });
      state.status = "submitted";
      state.reference = r.reference;
      el.confirm.hidden = true;
      el.modalScrim.hidden = true;
      render();
      showBanner(`Report submitted to Finance. Reference ${r.reference}.`);
    } catch (err) {
      el.confirmError.textContent = err.message;
      if (err.status === 409) {
        state.status = "submitted";
        render();
      } else {
        el.confirmOk.disabled = false;
      }
    }
  }

  el.confirmOk.addEventListener("click", submitReport);

  async function load() {
    const r = await api("GET", "/api/report");
    state.lines = r.lines;
    state.status = r.status;
    state.reference = r.reference;
    state.today = r.today;
    render();
    if (r.status === "submitted") showBanner(`Report submitted to Finance. Reference ${r.reference}.`);
  }

  load();
})();
