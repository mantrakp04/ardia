(() => {
  const view = document.getElementById("view");
  const input = document.getElementById("q");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let routeSeq = 0;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  function initials(name) {
    return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }

  function avatar(p, big) {
    const a = el("div", { class: `avatar${big ? " big" : ""}`, "aria-hidden": "true", text: initials(p.name) });
    a.style.background = `hsl(${p.photo_hue} 45% 42%)`;
    return a;
  }

  function longDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  async function get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function personRow(p, leadId) {
    const right = el("div");
    if (p.status) right.append(el("span", { class: "badge away", text: p.status }));
    else if (p.id === leadId) right.append(el("span", { class: "badge lead", text: "Team lead" }));
    return el("li", { class: "person" }, avatar(p),
      el("div", {}, el("a", { class: "name", href: `#/people/${p.id}`, text: p.name }),
        el("div", { class: "meta", text: `${p.title} · ${p.team} · ${p.location}` })),
      right);
  }

  function show(seq, ...nodes) {
    if (seq === routeSeq) view.replaceChildren(...nodes);
  }

  async function home(seq) {
    document.title = "People - Northwind Labs";
    const teams = await get("/api/teams");
    const byOrg = new Map();
    for (const t of teams) {
      if (!byOrg.has(t.org)) byOrg.set(t.org, []);
      byOrg.get(t.org).push(t);
    }
    const sections = [...byOrg.entries()].map(([org, list]) => el("section", { "aria-labelledby": `org-${org}` },
      el("h2", { class: "org", id: `org-${org}`, text: org }),
      el("ul", { class: "grid" }, ...list.map((t) => el("li", {}, el("a", { class: "card", href: `#/teams/${t.id}` },
        el("h2", { text: t.name }), el("p", { text: t.about }), el("div", { class: "size", text: `${t.size} ${t.size === 1 ? "person" : "people"}` })))))));
    show(seq, el("h1", { text: "Teams" }), el("p", { class: "sub", text: `${teams.reduce((n, t) => n + t.size, 0)} people across ${teams.length} teams at Northwind Labs` }), ...sections);
  }

  async function team(seq, id) {
    const t = await get(`/api/teams/${id}`);
    document.title = `${t.name} - Northwind People`;
    show(seq, 
      el("p", { class: "crumbs" }, el("a", { href: "#/", text: "Teams" }), ` › ${t.name}`),
      el("div", { class: "team-head" }, el("div", {}, el("h1", { text: t.name }), el("p", { class: "sub", text: t.about }),
        el("div", { class: "team-facts" }, el("span", {}, "Lead: ", el("a", { href: `#/people/${t.lead}`, text: t.lead_name })),
          el("span", { text: `Slack: ${t.slack}` }), el("span", { text: `${t.members.length} members` })))),
      el("ul", { class: "people", "aria-label": `${t.name} members` }, ...t.members.map((p) => personRow(p, t.lead))),
    );
  }

  async function person(seq, id) {
    const p = await get(`/api/people/${id}`);
    document.title = `${p.name} - Northwind People`;
    const local = new Date(Date.UTC(2026, 10, 6, 17, 30)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: p.timezone, timeZoneName: "short" });
    const facts = el("dl", { class: "facts" },
      el("dt", { text: "Email" }), el("dd", {}, el("a", { href: `mailto:${p.email}`, text: p.email })),
      el("dt", { text: "Phone" }), el("dd", { text: p.phone }),
      el("dt", { text: "Team" }), el("dd", {}, el("a", { href: `#/teams/${p.team_id}`, text: p.team })),
      el("dt", { text: "Manager" }), el("dd", {}, p.manager ? el("a", { href: `#/people/${p.manager.id}`, text: p.manager.name }) : "—"),
      el("dt", { text: "Location" }), el("dd", { text: p.location }),
      el("dt", { text: "Local time" }), el("dd", { text: local }),
      el("dt", { text: "Joined" }), el("dd", { text: longDate(p.joined) }),
    );
    const side = el("div", { class: "panel who" }, avatar(p, true), el("h1", { text: p.name }), el("p", { class: "title", text: p.title }),
      p.pronouns ? el("p", { class: "title", text: p.pronouns }) : null,
      p.status ? el("span", { class: "badge away", text: p.status }) : null);
    const main = el("div", { class: "stack" });
    if (p.about) main.append(el("p", { class: "status-note", text: p.about }));
    main.append(el("section", { class: "panel", "aria-labelledby": "contact-h" }, el("h2", { id: "contact-h", text: "Contact and team" }), facts));
    if (p.history.length) {
      main.append(el("section", { class: "panel", "aria-labelledby": "history-h" }, el("h2", { id: "history-h", text: "Team history" }),
        el("ul", { class: "timeline" }, ...p.history.map((h) => el("li", { text: `${h.team} · ${longDate(h.since)} – ${h.until ? longDate(h.until) : "present"}` })))));
    }
    if (p.reports.length) {
      main.append(el("section", { class: "panel", "aria-labelledby": "reports-h" }, el("h2", { id: "reports-h", text: `Direct reports (${p.reports.length})` }),
        el("ul", { class: "people" }, ...p.reports.map((r) => personRow(r)))));
    }
    show(seq, el("p", { class: "crumbs" }, el("a", { href: "#/", text: "Teams" }), " › ", el("a", { href: `#/teams/${p.team_id}`, text: p.team }), ` › ${p.name}`),
      el("div", { class: "profile" }, side, main));
  }

  async function results(seq, q) {
    document.title = `“${q}” - Northwind People`;
    input.value = q;
    const data = await get(`/api/people?q=${encodeURIComponent(q)}`);
    show(seq, el("h1", { text: "Search results" }),
      el("p", { class: "sub", text: data.total ? `${data.total} ${data.total === 1 ? "person matches" : "people match"} “${q}”` : `No one matches “${q}”.` }),
      data.people.length ? el("ul", { class: "people", "aria-label": "Search results" }, ...data.people.map((p) => personRow(p))) : null);
  }

  async function route() {
    const seq = ++routeSeq;
    const hash = decodeURIComponent(location.hash.slice(1) || "/");
    view.replaceChildren(el("div", { class: "loading", text: "Loading…" }));
    try {
      let m;
      if ((m = hash.match(/^\/teams\/([a-z-]+)$/))) await team(seq, m[1]);
      else if ((m = hash.match(/^\/people\/([a-z0-9-]+)$/))) await person(seq, m[1]);
      else if ((m = hash.match(/^\/search\?q=(.*)$/))) await results(seq, m[1]);
      else await home(seq);
    } catch {
      show(seq, el("h1", { text: "Not found" }), el("p", { class: "sub" }, "That page doesn’t exist. ", el("a", { href: "#/", text: "Browse teams" })));
    }
    if (seq === routeSeq) window.scrollTo(0, 0);
  }

  let timer = 0;
  function go() {
    const q = input.value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(go, 300);
  });
  document.getElementById("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    go();
  });
  window.addEventListener("hashchange", route);
  route();
})();
