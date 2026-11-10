import { request } from "../../../realism.js";

(() => {
  const ROW_H = 76;
  const OVERSCAN = 3;
  const PAGE = 40;
  const TODAY = new Date(2026, 10, 6, 9, 30);
  const SHIFT = 13;

  const listEl = document.getElementById("list");
  const spacer = document.getElementById("spacer");
  const reader = document.getElementById("reader");
  const searchEl = document.getElementById("search");
  const listMeta = document.getElementById("list-meta");
  const listTitle = document.getElementById("list-title");
  const unreadCount = document.getElementById("unread-count");

  const state = { q: "", total: 0, items: [], loading: false, generation: 0, selectedId: null, rows: new Map(), openSeq: 0 };

  const monthShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parse = (s) => new Date(s);

  function shortDate(s) {
    const d = parse(s);
    if (d.toDateString() === TODAY.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${monthShort[d.getMonth()]} ${d.getDate()}`;
  }

  function longDate(s) {
    return parse(s).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  async function fetchPage(offset) {
    const gen = state.generation;
    state.loading = true;
    renderRows();
    try {
      const r = await fetch(`/api/messages?offset=${offset}&limit=${PAGE}&q=${encodeURIComponent(state.q)}`);
      const data = await r.json();
      if (gen !== state.generation) return;
      state.total = data.total;
      state.items.splice(offset, data.messages.length, ...data.messages);
    } finally {
      if (gen === state.generation) {
        state.loading = false;
        renderMeta();
        renderRows();
      }
    }
  }

  function renderMeta() {
    listMeta.textContent = state.q ? `${state.total} result${state.total === 1 ? "" : "s"}` : `1–${Math.min(state.items.length, state.total)} of ${state.total}`;
    listTitle.textContent = state.q ? `Search: ${state.q}` : "Inbox";
    listEl.setAttribute("aria-label", state.q ? `Search results for ${state.q}` : "Inbox");
    if (!state.q) unreadCount.textContent = String(state.items.filter((m) => m.unread).length || "");
  }

  function rowEl(m, index) {
    const el = document.createElement("div");
    el.className = "row" + (m.unread ? " unread" : "");
    el.setAttribute("role", "option");
    el.setAttribute("aria-setsize", String(state.total));
    el.setAttribute("aria-posinset", String(index + 1));
    el.dataset.id = m.id;
    const from = document.createElement("span");
    from.className = "from";
    from.textContent = m.from.name;
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = shortDate(m.date);
    const subject = document.createElement("span");
    subject.className = "subject";
    subject.textContent = m.subject;
    if (m.has_attachment) {
      const clip = document.createElement("span");
      clip.className = "clip";
      clip.textContent = "📎";
      clip.setAttribute("aria-label", "has attachment");
      subject.append(clip);
    }
    const snippet = document.createElement("span");
    snippet.className = "snippet";
    snippet.textContent = m.snippet;
    el.append(from, date, subject, snippet);
    el.addEventListener("click", () => openMessage(m.id));
    return el;
  }

  function renderRows() {
    const top = listEl.scrollTop;
    const h = listEl.clientHeight || 600;
    const n = state.items.length;
    spacer.style.height = `${n * ROW_H + (n < state.total || state.loading ? 48 : 0)}px`;
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const last = Math.min(n, Math.ceil((top + h) / ROW_H) + OVERSCAN);
    const keep = new Set();
    for (let i = first; i < last; i++) {
      const m = state.items[i];
      if (!m) continue;
      keep.add(m.id);
      let el = state.rows.get(m.id);
      if (!el) {
        el = rowEl(m, i);
        state.rows.set(m.id, el);
        listEl.append(el);
      }
      el.style.transform = `translateY(${i * ROW_H}px)`;
      el.setAttribute("aria-posinset", String(i + 1));
      el.setAttribute("aria-setsize", String(state.total));
      el.setAttribute("aria-selected", m.id === state.selectedId ? "true" : "false");
      el.classList.toggle("unread", !!m.unread);
    }
    for (const [id, el] of state.rows) {
      if (!keep.has(id)) {
        el.remove();
        state.rows.delete(id);
      }
    }
    let loader = listEl.querySelector(".loading-row");
    if (state.loading || n < state.total) {
      if (!loader) {
        loader = document.createElement("div");
        loader.className = "loading-row";
        listEl.append(loader);
      }
      loader.textContent = state.loading ? "Loading…" : "";
      loader.style.transform = `translateY(${n * ROW_H}px)`;
    } else if (loader) {
      loader.remove();
    }
    if (!state.loading && n < state.total && last >= n - 4) fetchPage(n);
    if (!state.q && n === 0 && !state.loading && state.total === 0) {
      listMeta.textContent = "";
    }
  }

  function resetList() {
    state.generation++;
    state.items = [];
    state.total = 0;
    state.loading = false;
    for (const el of state.rows.values()) el.remove();
    state.rows.clear();
    listEl.scrollTop = 0;
    fetchPage(0);
  }

  let searchTimer = 0;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = searchEl.value.trim();
      if (q === state.q) return;
      state.q = q;
      resetList();
    }, 250);
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      state.q = searchEl.value.trim();
      resetList();
    }
    if (e.key === "Escape" && searchEl.value) {
      searchEl.value = "";
      state.q = "";
      resetList();
    }
  });

  let scrollRaf = 0;
  listEl.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      renderRows();
    });
  });
  window.addEventListener("resize", () => renderRows());

  listEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = state.items.findIndex((m) => m.id === state.selectedId);
    const next = Math.max(0, Math.min(state.items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    const m = state.items[next];
    if (!m) return;
    const y = next * ROW_H;
    if (y < listEl.scrollTop) listEl.scrollTop = y;
    else if (y + ROW_H > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = y + ROW_H - listEl.clientHeight;
    openMessage(m.id);
  });

  function decodeScan(data) {
    const bytes = atob(data);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode((bytes.charCodeAt(i) - SHIFT + 256) % 256);
    return out.split("\n");
  }

  function drawScan(canvas, att) {
    const lines = decodeScan(att.data);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = att.width || 360;
    const pad = 22;
    const lh = 22;
    const h = pad * 2 + lines.length * lh + 10;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fdfcf8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1b1b1b";
    ctx.textBaseline = "middle";
    let y = pad + lh / 2;
    for (const raw of lines) {
      let line = raw;
      let center = false;
      let bold = false;
      if (line.startsWith("^")) { center = true; line = line.slice(1); }
      if (line.startsWith("*")) { bold = true; line = line.slice(1); }
      ctx.font = `${bold ? "700 " : ""}${bold && center ? 22 : 15}px Menlo, "Courier New", monospace`;
      if (line === "-") {
        ctx.fillRect(pad, y, w - pad * 2, 1);
      } else if (center) {
        ctx.textAlign = "center";
        ctx.fillText(line, w / 2, y);
      } else {
        const [left, right] = line.split("|");
        ctx.textAlign = "left";
        ctx.fillText(left, pad, y);
        if (right) {
          ctx.textAlign = "right";
          ctx.fillText(right, w - pad, y);
        }
      }
      y += lh;
    }
  }

  function renderAttachments(msg) {
    if (!msg.attachments.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "attachments";
    for (const att of msg.attachments) {
      const fig = document.createElement("figure");
      fig.className = "attachment";
      const cap = document.createElement("figcaption");
      cap.textContent = `📎 ${att.name}`;
      fig.append(cap);
      if (att.kind === "scan") {
        const c = document.createElement("canvas");
        c.setAttribute("role", "img");
        c.setAttribute("aria-label", att.name);
        fig.append(c);
        drawScan(c, att);
      } else if (att.kind === "viewer") {
        const f = document.createElement("iframe");
        f.src = att.src;
        f.title = `${att.name} preview`;
        f.setAttribute("sandbox", "allow-scripts allow-same-origin");
        fig.append(f);
      }
      wrap.append(fig);
    }
    return wrap;
  }

  async function openMessage(id) {
    const seq = ++state.openSeq;
    state.selectedId = id;
    renderRows();
    if (location.hash !== `#/inbox/${id}`) history.replaceState(null, "", `#/inbox/${id}`);
    reader.innerHTML = '<div class="empty">Loading…</div>';
    const r = await fetch(`/api/messages/${id}`);
    if (seq !== state.openSeq) return;
    if (!r.ok) {
      reader.innerHTML = '<div class="empty">This message could not be loaded.</div>';
      return;
    }
    const msg = await r.json();
    const article = document.createElement("article");
    article.setAttribute("aria-labelledby", "msg-subject");
    const h = document.createElement("h2");
    h.id = "msg-subject";
    h.textContent = msg.subject;
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const sender = document.createElement("div");
    sender.className = "sender";
    const b = document.createElement("b");
    b.textContent = msg.from.name;
    sender.append(b, ` <${msg.from.email}>`, document.createElement("br"), `to ${msg.to.name} <${msg.to.email}>`);
    const when = document.createElement("time");
    when.dateTime = msg.date;
    when.textContent = longDate(msg.date);
    meta.append(sender, when);
    const body = document.createElement("div");
    body.className = "msg-body" + (msg.body.type === "text" ? " plain" : "");
    if (msg.body.type === "text") body.textContent = msg.body.content;
    else body.innerHTML = msg.body.content;
    article.append(h, meta, body);
    const atts = renderAttachments(msg);
    if (atts) article.append(atts);
    reader.replaceChildren(article);
    reader.scrollTop = 0;
    const item = state.items.find((m) => m.id === id);
    if (item && item.unread) {
      item.unread = false;
      renderRows();
      renderMeta();
      request(`/api/messages/${id}/read`, { method: "POST" });
    }
  }

  const initial = location.hash.match(/^#\/inbox\/([0-9a-f]{12})$/);
  fetchPage(0).then(() => { if (initial) openMessage(initial[1]); });
})();
