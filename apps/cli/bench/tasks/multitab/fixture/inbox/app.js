(() => {
  const TODAY = new Date(2026, 10, 6, 9, 30);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const list = document.getElementById("list");
  const reader = document.getElementById("reader");
  const search = document.getElementById("search");
  const meta = document.getElementById("list-meta");
  const title = document.getElementById("list-title");
  const unreadCount = document.getElementById("unread-count");
  const state = { folder: "inbox", q: "", messages: [], selected: null, loadSeq: 0, openSeq: 0 };

  function shortDate(iso) {
    const d = new Date(iso);
    if (d.toDateString() === TODAY.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  function longDate(iso) {
    return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function visible() {
    if (state.folder === "starred") return state.messages.filter((m) => m.starred);
    if (state.folder === "inbox") return state.messages;
    return [];
  }

  function render() {
    const items = visible();
    const names = { inbox: "Inbox", starred: "Starred", sent: "Sent", drafts: "Drafts", archive: "Archive" };
    title.textContent = state.q ? `Results for “${state.q}”` : names[state.folder];
    meta.textContent = items.length ? `${items.length} conversation${items.length === 1 ? "" : "s"}` : "";
    unreadCount.textContent = state.q ? unreadCount.textContent : String(state.messages.filter((m) => m.unread).length || "");
    for (const link of document.querySelectorAll(".folder")) {
      if (link.dataset.folder === state.folder && !state.q) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "placeholder";
      li.textContent = state.q ? "No messages matched your search." : "Nothing here.";
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...items.map((m) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "row" + (m.unread ? " unread" : "");
      if (m.id === state.selected) button.setAttribute("aria-current", "true");
      const from = document.createElement("span");
      from.className = "from";
      from.textContent = m.from.name;
      if (m.starred) {
        const star = document.createElement("span");
        star.className = "star";
        star.textContent = "★";
        star.setAttribute("aria-label", "Starred");
        from.append(star);
      }
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = shortDate(m.date);
      const subject = document.createElement("span");
      subject.className = "subject";
      subject.textContent = m.subject;
      const snippet = document.createElement("span");
      snippet.className = "snippet";
      snippet.textContent = m.snippet;
      button.append(from, date, subject, snippet);
      button.addEventListener("click", () => { location.hash = `#/${state.folder}/${m.id}`; });
      li.append(button);
      return li;
    }));
  }

  async function load() {
    const seq = ++state.loadSeq;
    meta.textContent = "Loading…";
    const response = await fetch(`/api/messages?q=${encodeURIComponent(state.q)}`);
    const data = await response.json();
    if (seq !== state.loadSeq) return;
    state.messages = data.messages;
    render();
  }

  async function open(id) {
    const seq = ++state.openSeq;
    state.selected = id;
    render();
    reader.innerHTML = '<div class="empty">Loading…</div>';
    const response = await fetch(`/api/messages/${id}`);
    if (seq !== state.openSeq) return;
    if (!response.ok) {
      reader.innerHTML = '<div class="empty">This message could not be loaded.</div>';
      return;
    }
    const msg = await response.json();
    const article = document.createElement("article");
    article.setAttribute("aria-labelledby", "msg-subject");
    const h = document.createElement("h2");
    h.id = "msg-subject";
    h.textContent = msg.subject;
    const head = document.createElement("div");
    head.className = "msg-meta";
    const sender = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = msg.from.name;
    sender.append(b, ` <${msg.from.email}>`, document.createElement("br"), `to ${msg.to.name} <${msg.to.email}>`);
    const when = document.createElement("time");
    when.dateTime = msg.date;
    when.textContent = longDate(msg.date);
    head.append(sender, when);
    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = msg.body;
    article.append(h, head, body);
    reader.replaceChildren(article);
    reader.scrollTop = 0;
    const item = state.messages.find((m) => m.id === id);
    if (item && item.unread) {
      item.unread = false;
      render();
      fetch(`/api/messages/${id}/read`, { method: "POST" });
    }
  }

  function route() {
    const match = location.hash.match(/^#\/(inbox|starred|sent|drafts|archive)(?:\/(m\d+))?$/);
    const folder = match ? match[1] : "inbox";
    const id = match && match[2];
    if (folder !== state.folder) {
      state.folder = folder;
      render();
    }
    if (id) open(id);
    else {
      state.selected = null;
      render();
      reader.innerHTML = '<div class="empty">Select a message to read it.</div>';
    }
  }

  let timer = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = search.value.trim();
      load();
    }, 250);
  });
  document.getElementById("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    state.q = search.value.trim();
    load();
  });
  window.addEventListener("hashchange", route);
  load().then(route);
})();
