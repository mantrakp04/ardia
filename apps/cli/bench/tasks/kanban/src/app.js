import { request } from "../../realism.js";

const $ = (id) => document.getElementById(id);
const TODAY = "2026-11-06";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AVATAR_COLORS = ["#5b4cdb", "#1f845a", "#c25100", "#0c66e4", "#ae2e24", "#6e5dc6", "#227d9b"];

const el = {
  board: $("board"), live: $("live"), menu: $("menu"), team: $("team"), syncState: $("sync-state"), toast: $("toast"),
  details: $("details"), dRef: $("d-ref"), dTitle: $("d-title"), dDesc: $("d-desc"), dLabels: $("d-labels"),
  dColumn: $("d-column"), dAssignee: $("d-assignee"), dDue: $("d-due"), dDueClear: $("d-due-clear"), dError: $("d-error"),
  dSaved: $("d-saved"), dArchive: $("d-archive"), dDelete: $("d-delete"), dClose: $("d-close"),
  confirm: $("confirm"), cTitle: $("c-title"), cBody: $("c-body"), cOk: $("c-ok"), cCancel: $("c-cancel"),
  archive: $("archive"), aList: $("a-list"), aClose: $("a-close"), openArchive: $("open-archive"),
};

const state = { board: null, cards: new Map(), lifted: null, dragId: null, dropAt: null, openId: null, menuFor: null, composing: null, queue: Promise.resolve(), pending: 0 };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const initials = (name) => name.split(" ").map((p) => p[0]).join("").slice(0, 2);
const colorFor = (name) => AVATAR_COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const shortDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${y !== 2026 ? ", " + y : ""}`;
};
const addDays = (s, n) => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const columnName = (key) => state.board.columns.find((c) => c.key === key).name;

function announce(text) {
  el.live.textContent = "";
  setTimeout(() => { el.live.textContent = text; }, 40);
}

let toastTimer = 0;
function toast(text, undo) {
  el.toast.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  el.toast.append(span);
  if (undo) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Undo";
    btn.addEventListener("click", () => { el.toast.hidden = true; undo(); });
    el.toast.append(btn);
  }
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 6000);
}

function setSync() {
  el.syncState.textContent = state.pending ? "Saving…" : state.saved ? "All changes saved" : "";
}

function send(method, path, body) {
  state.pending++;
  setSync();
  const run = async () => {
    try {
      const res = await request(path, { method, body });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
      state.saved = true;
      accept(data);
      return data;
    } finally {
      state.pending--;
      setSync();
    }
  };
  const p = state.queue.then(run, run);
  state.queue = p.catch(() => {});
  return p.catch((err) => {
    toast(`Couldn't save: ${err.message}`);
    return load();
  });
}

function accept(board) {
  state.board = board;
  state.cards = new Map(board.cards.map((c) => [c.id, c]));
  render();
  if (state.openId) fillDetails();
  if (el.archive.open) renderArchive();
}

function orderFor(colKey) {
  const col = state.board.columns.find((c) => c.key === colKey);
  let ids = col.cards.slice();
  const lifted = state.lifted;
  if (lifted) {
    ids = ids.filter((id) => id !== lifted.id);
    if (lifted.col === colKey) ids.splice(lifted.idx, 0, lifted.id);
  }
  return ids;
}

function dueHtml(due) {
  if (!due) return "";
  const cls = due < TODAY ? " overdue" : due <= addDays(TODAY, 2) ? " soon" : "";
  const word = due < TODAY ? "Overdue, due" : "Due";
  return `<span class="due${cls}" title="${word} ${escapeHtml(shortDate(due))}"><span class="sr">${word} </span>${escapeHtml(shortDate(due))}</span>`;
}

function avatarHtml(name) {
  if (!name) return `<span class="avatar" title="Unassigned" style="background:#dfe1e6;color:#5e6c84">?</span>`;
  return `<span class="avatar" title="${escapeHtml(name)}" style="background:${colorFor(name)}">${escapeHtml(initials(name))}</span>`;
}

function cardHtml(card) {
  const lifted = state.lifted && state.lifted.id === card.id ? " lifted" : "";
  const tags = card.labels.map((l) => `<span class="tag" data-l="${escapeHtml(l)}">${escapeHtml(l)}</span>`).join("");
  return `<li><article class="card${lifted}" tabindex="0" draggable="true" data-id="${card.id}" aria-labelledby="t-${card.id}" aria-describedby="dnd-help"${lifted ? ' aria-grabbed="true"' : ""}>` +
    `<div class="card-top"><span class="card-ref">${card.id}</span>` +
    `<button type="button" class="icon card-menu" data-menu="${card.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${escapeHtml(card.title)}">⋯</button></div>` +
    `<h3 class="card-title" id="t-${card.id}">${escapeHtml(card.title)}</h3>` +
    (tags ? `<div class="tags"><span class="sr">Labels: </span>${tags}</div>` : "") +
    `<div class="card-foot">${dueHtml(card.due) || "<span></span>"}${avatarHtml(card.assignee)}</div></article></li>`;
}

function columnHtml(col) {
  const ids = orderFor(col.key);
  const target = state.lifted && state.lifted.col === col.key ? " drop-target" : "";
  if (col.collapsed) {
    return `<section class="column collapsed${target}" data-col="${col.key}" aria-label="${escapeHtml(col.name)}">` +
      `<button type="button" class="col-toggle" data-expand="${col.key}" aria-expanded="false" aria-label="${escapeHtml(col.name)}, ${ids.length} cards. Expand column">` +
      `<span class="col-count">${ids.length}</span><span class="vname">${escapeHtml(col.name)}</span></button></section>`;
  }
  const composer = state.composing === col.key
    ? `<form class="composer" data-compose="${col.key}"><label class="sr" for="compose-${col.key}">Card title</label>` +
      `<textarea id="compose-${col.key}" rows="2" placeholder="Enter a title for this card…"></textarea>` +
      `<div class="composer-actions"><button class="btn primary small" type="submit">Add card</button><button class="btn small" type="button" data-cancel-compose>Cancel</button></div></form>`
    : `<button type="button" class="add-card" data-add="${col.key}">＋ Add a card</button>`;
  return `<section class="column${target}" data-col="${col.key}" aria-labelledby="h-${col.key}">` +
    `<div class="col-head"><h2 id="h-${col.key}">${escapeHtml(col.name)}</h2><span class="col-count" aria-label="${ids.length} cards">${ids.length}</span>` +
    `<button type="button" class="icon" data-collapse="${col.key}" aria-label="Collapse ${escapeHtml(col.name)}" title="Collapse">⇤</button></div>` +
    `<ul class="cards" data-list="${col.key}">${ids.map((id) => cardHtml(state.cards.get(id))).join("")}</ul>${composer}</section>`;
}

function render() {
  const active = document.activeElement;
  const focusId = state.focusId || (active && active.closest && active.closest(".card") ? active.closest(".card").dataset.id : null);
  const menuFocus = active && active.dataset && active.dataset.menu;
  const scrolls = {};
  el.board.querySelectorAll("[data-list]").forEach((ul) => { scrolls[ul.dataset.list] = ul.scrollTop; });
  el.board.innerHTML = state.board.columns.map(columnHtml).join("");
  el.board.querySelectorAll("[data-list]").forEach((ul) => { ul.scrollTop = scrolls[ul.dataset.list] || 0; });
  const archived = state.board.cards.filter((c) => c.archived).length;
  el.openArchive.textContent = archived ? `Archived · ${archived}` : "Archived";
  state.focusId = null;
  if (menuFocus) {
    const btn = el.board.querySelector(`[data-menu="${menuFocus}"]`);
    if (btn && !el.menu.hidden) return;
    if (btn) btn.focus({ preventScroll: true });
  } else if (focusId && !el.details.open && !el.confirm.open && !el.archive.open) {
    const node = el.board.querySelector(`.card[data-id="${focusId}"]`);
    if (node) {
      node.focus({ preventScroll: true });
      node.scrollIntoView({ block: "nearest" });
    }
  }
  if (state.composing) {
    const ta = $(`compose-${state.composing}`);
    if (ta && document.activeElement !== ta) ta.focus();
  }
}

function position(colKey, id) {
  const ids = orderFor(colKey);
  return { index: ids.indexOf(id), count: ids.length };
}

function lift(id) {
  const card = state.cards.get(id);
  const col = state.board.columns.find((c) => c.key === card.column);
  const idx = col.cards.indexOf(id);
  state.lifted = { id, fromCol: card.column, fromIdx: idx, col: card.column, idx };
  state.focusId = id;
  render();
  announce(`Picked up ${card.title}. ${col.name}, position ${idx + 1} of ${col.cards.length}. Use arrow keys to move, Space to drop, Escape to cancel.`);
}

function moveLifted(dCol, dIdx) {
  const lifted = state.lifted;
  const keys = state.board.columns.map((c) => c.key);
  let ci = keys.indexOf(lifted.col);
  if (dCol) {
    const next = ci + dCol;
    if (next < 0 || next >= keys.length) return;
    ci = next;
    lifted.col = keys[ci];
    const others = state.board.columns[ci].cards.filter((x) => x !== lifted.id).length;
    lifted.idx = state.board.columns[ci].collapsed ? 0 : Math.min(lifted.idx, others);
  } else {
    const others = state.board.columns[ci].cards.filter((x) => x !== lifted.id).length;
    const nextIdx = lifted.idx + dIdx;
    if (nextIdx < 0 || nextIdx > others) return;
    lifted.idx = nextIdx;
  }
  state.focusId = lifted.id;
  render();
  const col = state.board.columns[ci];
  const { count } = position(col.key, lifted.id);
  announce(`${col.name}${col.collapsed ? " (collapsed)" : ""}, position ${lifted.idx + 1} of ${count}.`);
}

function dropLifted() {
  const lifted = state.lifted;
  state.lifted = null;
  state.focusId = lifted.id;
  const card = state.cards.get(lifted.id);
  if (lifted.col === lifted.fromCol && lifted.idx === lifted.fromIdx) {
    render();
    announce(`${card.title} dropped. No change.`);
    return;
  }
  commitMove(lifted.id, lifted.col, lifted.idx);
  announce(`${card.title} dropped in ${columnName(lifted.col)} at position ${lifted.idx + 1}.`);
}

function cancelLift() {
  const lifted = state.lifted;
  state.lifted = null;
  state.focusId = lifted.id;
  render();
  announce(`Move cancelled. ${state.cards.get(lifted.id).title} is back in ${columnName(lifted.fromCol)} at position ${lifted.fromIdx + 1}.`);
}

function commitMove(id, colKey, index) {
  const col = state.board.columns.find((c) => c.key === colKey);
  const from = state.board.columns.find((c) => c.cards.includes(id));
  if (from) from.cards = from.cards.filter((x) => x !== id);
  col.cards.splice(Math.max(0, Math.min(index, col.cards.length)), 0, id);
  state.cards.get(id).column = colKey;
  render();
  return send("POST", `/api/cards/${id}/move`, { column: colKey, index });
}

document.addEventListener("keydown", (e) => {
  if (!state.lifted) return;
  const keys = { ArrowLeft: () => moveLifted(-1, 0), ArrowRight: () => moveLifted(1, 0), ArrowUp: () => moveLifted(0, -1), ArrowDown: () => moveLifted(0, 1), " ": dropLifted, Enter: dropLifted, Escape: cancelLift, Tab: cancelLift };
  if (keys[e.key]) {
    e.preventDefault();
    e.stopPropagation();
    keys[e.key]();
  }
}, true);

el.board.addEventListener("keydown", (e) => {
  const card = e.target.classList && e.target.classList.contains("card") ? e.target : null;
  if (!card || state.lifted) return;
  if (e.key === " ") {
    e.preventDefault();
    lift(card.dataset.id);
  } else if (e.key === "Enter") {
    e.preventDefault();
    openDetails(card.dataset.id);
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const cards = [...card.closest("[data-list]").querySelectorAll(".card")];
    const next = cards[cards.indexOf(card) + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) next.focus();
  }
});

el.board.addEventListener("click", (e) => {
  const t = e.target;
  const menuBtn = t.closest("[data-menu]");
  if (menuBtn) return openMenu(menuBtn);
  const expand = t.closest("[data-expand]");
  if (expand) return setCollapsed(expand.dataset.expand, false);
  const collapse = t.closest("[data-collapse]");
  if (collapse) return setCollapsed(collapse.dataset.collapse, true);
  const add = t.closest("[data-add]");
  if (add) {
    state.composing = add.dataset.add;
    return render();
  }
  if (t.closest("[data-cancel-compose]")) {
    state.composing = null;
    return render();
  }
  const card = t.closest(".card");
  if (card && !state.lifted) openDetails(card.dataset.id);
});

el.board.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-compose]");
  if (!form) return;
  e.preventDefault();
  const title = form.querySelector("textarea").value.trim();
  if (!title) return;
  state.composing = null;
  send("POST", "/api/cards", { column: form.dataset.compose, title }).then(() => announce(`Added ${title}.`));
});

el.board.addEventListener("keydown", (e) => {
  const ta = e.target.closest && e.target.closest("[data-compose] textarea");
  if (!ta) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    ta.form.requestSubmit();
  } else if (e.key === "Escape") {
    state.composing = null;
    render();
  }
});

function setCollapsed(key, collapsed) {
  const col = state.board.columns.find((c) => c.key === key);
  col.collapsed = collapsed;
  render();
  const focus = el.board.querySelector(collapsed ? `[data-expand="${key}"]` : `[data-collapse="${key}"]`);
  if (focus) focus.focus();
  send("POST", `/api/columns/${key}/collapse`, { collapsed });
}

function dropIndex(list, clientY) {
  const cards = [...list.querySelectorAll(".card")].filter((c) => c.dataset.id !== state.dragId);
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return cards.length;
}

function clearDropMarks() {
  el.board.querySelectorAll(".drop-line").forEach((n) => n.remove());
  el.board.querySelectorAll(".column.drop-target").forEach((n) => n.classList.remove("drop-target"));
}

function showDropLine(column, list, index) {
  clearDropMarks();
  column.classList.add("drop-target");
  if (!list) return;
  const items = [...list.children].filter((li) => li.querySelector(".card") && li.querySelector(".card").dataset.id !== state.dragId);
  const line = document.createElement("li");
  line.className = "drop-line";
  line.setAttribute("aria-hidden", "true");
  list.insertBefore(line, items[index] || null);
}

el.board.addEventListener("dragstart", (e) => {
  const card = e.target.closest && e.target.closest(".card");
  if (!card) return;
  state.dragId = card.dataset.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.id);
  closeMenu();
  requestAnimationFrame(() => card.classList.add("dragging"));
});

el.board.addEventListener("dragover", (e) => {
  if (!state.dragId) return;
  const column = e.target.closest(".column");
  if (!column) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const key = column.dataset.col;
  const list = column.querySelector("[data-list]");
  const index = list ? dropIndex(list, e.clientY) : 0;
  if (!state.dropAt || state.dropAt.col !== key || state.dropAt.index !== index) {
    state.dropAt = { col: key, index };
    showDropLine(column, list, index);
  }
});

el.board.addEventListener("dragleave", (e) => {
  if (!state.dragId) return;
  if (e.relatedTarget && el.board.contains(e.relatedTarget) && e.relatedTarget.closest(".column")) return;
  state.dropAt = null;
  clearDropMarks();
});

el.board.addEventListener("drop", (e) => {
  if (!state.dragId) return;
  e.preventDefault();
  const id = state.dragId;
  const at = state.dropAt;
  state.dragId = null;
  state.dropAt = null;
  clearDropMarks();
  if (!at) return render();
  const card = state.cards.get(id);
  const from = state.board.columns.find((c) => c.cards.includes(id));
  if (from && from.key === at.col && from.cards.indexOf(id) === at.index) return render();
  commitMove(id, at.col, at.index);
  announce(`${card.title} moved to ${columnName(at.col)}, position ${at.index + 1}.`);
});

el.board.addEventListener("dragend", () => {
  state.dragId = null;
  state.dropAt = null;
  clearDropMarks();
  el.board.querySelectorAll(".card.dragging").forEach((n) => n.classList.remove("dragging"));
});

function menuItem(label, action, opts = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", "menuitem");
  b.tabIndex = -1;
  b.textContent = label;
  if (opts.danger) b.className = "danger";
  if (opts.disabled) b.setAttribute("aria-disabled", "true");
  b.addEventListener("click", () => {
    if (opts.disabled) return;
    const id = state.menuFor;
    closeMenu(false);
    action(id);
  });
  return b;
}

function openMenu(btn) {
  if (state.menuFor === btn.dataset.menu && !el.menu.hidden) return closeMenu();
  const id = btn.dataset.menu;
  const card = state.cards.get(id);
  const col = state.board.columns.find((c) => c.key === card.column);
  const idx = col.cards.indexOf(id);
  state.menuFor = id;
  el.menu.innerHTML = "";
  el.menu.setAttribute("aria-label", `Actions for ${card.title}`);
  el.menu.append(menuItem("Open card", openDetails));
  el.menu.append(menuItem("Move to top of column", (x) => commitMove(x, col.key, 0), { disabled: idx === 0 }));
  el.menu.append(menuItem("Move to bottom of column", (x) => commitMove(x, col.key, col.cards.length - 1), { disabled: idx === col.cards.length - 1 }));
  const group = document.createElement("div");
  group.className = "group";
  group.setAttribute("role", "presentation");
  group.textContent = "Move to…";
  el.menu.append(document.createElement("hr"), group);
  for (const c of state.board.columns) {
    if (c.key === col.key) continue;
    el.menu.append(menuItem(c.name, (x) => {
      const target = state.board.columns.find((k) => k.key === c.key);
      commitMove(x, c.key, target.cards.length).then(() => toast(`Moved to ${c.name}.`));
    }));
  }
  el.menu.append(document.createElement("hr"));
  el.menu.append(menuItem("Archive", confirmArchive));
  el.menu.append(menuItem("Delete…", confirmDelete, { danger: true }));
  el.menu.hidden = false;
  const r = btn.getBoundingClientRect();
  const mh = el.menu.offsetHeight;
  el.menu.style.left = Math.min(r.left, window.innerWidth - el.menu.offsetWidth - 8) + "px";
  el.menu.style.top = (r.bottom + 4 + mh > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + "px";
  btn.setAttribute("aria-expanded", "true");
  const first = el.menu.querySelector("[role=menuitem]:not([aria-disabled=true])");
  if (first) first.focus();
}

function closeMenu(restoreFocus = true) {
  if (el.menu.hidden) return;
  el.menu.hidden = true;
  const btn = el.board.querySelector(`[data-menu="${state.menuFor}"]`);
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    if (restoreFocus) btn.focus();
  }
  state.menuFor = null;
}

el.menu.addEventListener("keydown", (e) => {
  const items = [...el.menu.querySelectorAll("[role=menuitem]")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length].focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    items[e.key === "Home" ? 0 : items.length - 1].focus();
  } else if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    closeMenu();
  }
});

document.addEventListener("mousedown", (e) => {
  if (!el.menu.hidden && !el.menu.contains(e.target) && !e.target.closest("[data-menu]")) closeMenu(false);
});

function ask(title, body, okLabel, danger) {
  return new Promise((resolve) => {
    el.cTitle.textContent = title;
    el.cBody.textContent = body;
    el.cOk.textContent = okLabel;
    el.cOk.className = danger ? "btn danger" : "btn primary";
    const done = (v) => {
      el.cOk.onclick = null;
      el.cCancel.onclick = null;
      el.confirm.onclose = null;
      if (el.confirm.open) el.confirm.close();
      resolve(v);
    };
    el.cOk.onclick = () => done(true);
    el.cCancel.onclick = () => done(false);
    el.confirm.onclose = () => done(false);
    el.confirm.showModal();
    el.cCancel.focus();
  });
}

async function confirmArchive(id) {
  const card = state.cards.get(id);
  const intent = request(`/api/cards/${id}/archive-intent`, { method: "POST" })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && data.intent) || null, () => null);
  const ok = await ask(`Archive ${card.id}?`, `"${card.title}" will be hidden from the board. You can restore it from Archived at any time.`, "Archive card", false);
  if (!ok) return;
  if (state.openId === id) closeDetails();
  await send("PATCH", `/api/cards/${id}`, { archived: true, intent: await intent });
  toast(`Archived ${card.id}.`, () => send("PATCH", `/api/cards/${id}`, { archived: false }));
}

async function confirmDelete(id) {
  const card = state.cards.get(id);
  const ok = await ask(`Delete ${card.id} permanently?`, `"${card.title}" and its history will be deleted. This can't be undone. To hide it from the board instead, archive it.`, "Delete permanently", true);
  if (!ok) return;
  if (state.openId === id) closeDetails();
  await send("DELETE", `/api/cards/${id}`);
  toast(`Deleted ${card.id}.`);
}

function fillDetails() {
  const card = state.cards.get(state.openId);
  if (!card || card.archived) return closeDetails();
  el.dRef.textContent = `${card.id} · ${columnName(card.column)}`;
  el.dTitle.textContent = card.title;
  if (document.activeElement !== el.dDesc) el.dDesc.value = card.description;
  el.dColumn.value = card.column;
  el.dAssignee.value = card.assignee;
  if (document.activeElement !== el.dDue) el.dDue.value = card.due;
  el.dLabels.querySelectorAll(".chip").forEach((chip) => chip.setAttribute("aria-pressed", String(card.labels.includes(chip.dataset.label))));
}

function openDetails(id) {
  closeMenu(false);
  state.openId = id;
  el.dError.textContent = "";
  el.dSaved.textContent = "";
  fillDetails();
  el.details.showModal();
  el.dClose.focus();
}

function closeDetails() {
  const id = state.openId;
  state.openId = null;
  if (el.details.open) el.details.close();
  if (id && state.cards.has(id)) {
    state.focusId = id;
    render();
  }
}

function saveCard(patch, message) {
  const id = state.openId;
  if (!id) return Promise.resolve();
  el.dError.textContent = "";
  el.dSaved.textContent = "Saving…";
  return send("PATCH", `/api/cards/${id}`, patch).then((data) => {
    el.dSaved.textContent = data ? message || "Saved" : "";
  });
}

el.dClose.addEventListener("click", closeDetails);
el.details.addEventListener("close", () => {
  if (state.openId) closeDetails();
});
el.dColumn.addEventListener("change", () => {
  const id = state.openId;
  const key = el.dColumn.value;
  const target = state.board.columns.find((c) => c.key === key);
  el.dSaved.textContent = "Saving…";
  commitMove(id, key, target.cards.filter((x) => x !== id).length).then(() => { el.dSaved.textContent = `Moved to ${target.name}`; });
});
el.dAssignee.addEventListener("change", () => saveCard({ assignee: el.dAssignee.value }, el.dAssignee.value ? `Assigned to ${el.dAssignee.value}` : "Unassigned"));
el.dDue.addEventListener("change", () => {
  const v = el.dDue.value;
  if (!el.dDue.validity.valid || (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
    el.dError.textContent = "Enter a date between Jan 1, 2026 and Dec 31, 2027.";
    return;
  }
  saveCard({ due: v }, v ? `Due ${shortDate(v)}` : "Due date removed");
});
el.dDueClear.addEventListener("click", () => {
  el.dDue.value = "";
  saveCard({ due: "" }, "Due date removed");
});
el.dDesc.addEventListener("change", () => saveCard({ description: el.dDesc.value }, "Description saved"));
el.dLabels.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const card = state.cards.get(state.openId);
  const label = chip.dataset.label;
  const on = !card.labels.includes(label);
  const labels = on ? card.labels.concat(label) : card.labels.filter((l) => l !== label);
  chip.setAttribute("aria-pressed", String(on));
  saveCard({ labels }, on ? `Added ${label}` : `Removed ${label}`);
});
el.dArchive.addEventListener("click", () => confirmArchive(state.openId));
el.dDelete.addEventListener("click", () => confirmDelete(state.openId));

function renderArchive() {
  const cards = state.board.cards.filter((c) => c.archived);
  el.aList.innerHTML = cards.length
    ? cards.map((c) => `<li><div><div class="card-ref">${c.id} · ${escapeHtml(columnName(c.column))}</div>${escapeHtml(c.title)}</div>` +
      `<button type="button" class="btn small" data-restore="${c.id}">Restore</button></li>`).join("")
    : `<li class="empty">No archived cards.</li>`;
}

el.openArchive.addEventListener("click", () => {
  renderArchive();
  el.archive.showModal();
});
el.aClose.addEventListener("click", () => el.archive.close());
el.aList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-restore]");
  if (!btn) return;
  const id = btn.dataset.restore;
  send("PATCH", `/api/cards/${id}`, { archived: false }).then(() => toast(`Restored ${id} to ${columnName(state.cards.get(id).column)}.`));
});

function setupStatic(board) {
  el.dColumn.innerHTML = board.columns.map((c) => `<option value="${c.key}">${escapeHtml(c.name)}</option>`).join("");
  el.dAssignee.innerHTML = `<option value="">Unassigned</option>` + board.people.map((p) => `<option>${escapeHtml(p)}</option>`).join("");
  el.dLabels.innerHTML = board.labels.map((l) => `<button type="button" class="chip" data-label="${escapeHtml(l)}" aria-pressed="false">${escapeHtml(l)}</button>`).join("");
  el.team.innerHTML = board.people.map(avatarHtml).join("");
}

async function load() {
  try {
    const res = await request("/api/board");
    if (!res.ok) throw new Error(String(res.status));
    const board = await res.json();
    if (!state.board) setupStatic(board);
    accept(board);
  } catch {
    el.board.innerHTML = `<p class="loading">Couldn't load the board. Reload to try again.</p>`;
  }
}

load();
