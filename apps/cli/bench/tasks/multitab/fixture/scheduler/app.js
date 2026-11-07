(() => {
  const TODAY = "2026-11-06";
  const NOW_MINUTES = 9 * 60 + 30;
  const FIRST_HOUR = 7;
  const LAST_HOUR = 20;
  const HOUR_PX = 48;
  const ME = "jordan@northwind.dev";
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[a-z]{2,}$/i;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const details = $("details");
  const editor = $("editor");
  const form = $("meeting-form");
  const guestInput = $("guest-input");
  const options = $("guest-options");
  const guestList = $("guests");
  const roomList = $("room-list");
  const toast = $("toast");

  const state = { week: mondayOf(TODAY), meetings: [], editing: null, guests: [], room: "", rooms: [], suggestions: [], active: -1, searchSeq: 0, roomSeq: 0 };

  function toDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function toISO(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    const d = toDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return toISO(d);
  }

  function mondayOf(iso) {
    const day = toDate(iso).getUTCDay();
    return addDays(iso, day === 0 ? -6 : 1 - day);
  }

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  function clock(total) {
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

  function span(start, duration) {
    const s = toMinutes(start);
    return `${clock(s)} – ${clock(s + duration)}`;
  }

  function longDay(iso) {
    const d = toDate(iso);
    return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  function dot(name, hue) {
    const d = el("span", { class: "dot", "aria-hidden": "true", text: name.split(/[\s.@]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() });
    if (hue !== undefined) d.style.background = `hsl(${hue} 45% 45%)`;
    return d;
  }

  function flash(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  async function loadWeek() {
    const from = state.week;
    const to = addDays(from, 6);
    const start = toDate(from);
    const end = toDate(addDays(from, 4));
    const sameMonth = start.getUTCMonth() === end.getUTCMonth();
    $("range").textContent = sameMonth
      ? `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${end.getUTCDate()}, ${end.getUTCFullYear()}`
      : `${MONTHS[start.getUTCMonth()].slice(0, 3)} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()].slice(0, 3)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
    const response = await fetch(`/api/meetings?from=${from}&to=${to}`);
    const meetings = await response.json();
    if (from !== state.week) return;
    state.meetings = meetings;
    renderGrid();
  }

  function renderGrid() {
    const nodes = [el("div", { class: "corner" })];
    for (let i = 0; i < 5; i++) {
      const iso = addDays(state.week, i);
      const d = toDate(iso);
      nodes.push(el("div", { class: `day-head${iso === TODAY ? " today" : ""}`, role: "columnheader" },
        el("div", { class: "dow", text: DAYS[d.getUTCDay()].slice(0, 3) }), el("div", { class: "dnum", text: String(d.getUTCDate()) })));
    }
    const hours = el("div", { class: "hours", "aria-hidden": "true" });
    for (let h = FIRST_HOUR; h < LAST_HOUR; h++) hours.append(el("div", { class: "hour-label", text: h === FIRST_HOUR ? "" : clock(h * 60).replace(":00", "") }));
    nodes.push(hours);
    for (let i = 0; i < 5; i++) {
      const iso = addDays(state.week, i);
      const col = el("div", { class: "col", role: "gridcell", "aria-label": longDay(iso) });
      col.style.height = `${(LAST_HOUR - FIRST_HOUR) * HOUR_PX}px`;
      if (iso === TODAY) {
        const now = el("div", { class: "now", "aria-hidden": "true" });
        now.style.top = `${((NOW_MINUTES - FIRST_HOUR * 60) / 60) * HOUR_PX}px`;
        col.append(now);
      }
      for (const m of state.meetings.filter((x) => x.date === iso).sort((a, b) => a.start.localeCompare(b.start))) {
        const top = ((toMinutes(m.start) - FIRST_HOUR * 60) / 60) * HOUR_PX;
        const button = el("button", { type: "button", class: `event${m.seeded ? (m.organizer === ME ? " mine" : "") : " new"}`, onclick: (e) => showDetails(m, e.currentTarget) },
          el("b", { text: m.title }), `${span(m.start, m.duration)}${m.room_name ? `, ${m.room_name}` : ""}`);
        button.style.top = `${top}px`;
        button.style.height = `${Math.max(18, (m.duration / 60) * HOUR_PX - 2)}px`;
        col.append(button);
      }
      nodes.push(col);
    }
    grid.replaceChildren(...nodes);
  }

  function closeDetails() {
    details.hidden = true;
    if (closeDetails.returnTo) closeDetails.returnTo.focus();
  }

  function showDetails(m, opener) {
    closeDetails.returnTo = opener;
    const guests = el("ul", { "aria-label": "Guests" }, el("li", { text: m.organizer === ME ? "Jordan Lee (organizer)" : `${m.organizer} (organizer)` }),
      ...m.guests.map((g) => el("li", { text: g.external ? `${g.email} (guest)` : `${g.name} · ${g.email}` })));
    const top = el("div", { class: "d-top" }, el("button", { type: "button", class: "icon", "aria-label": "Close", text: "×", onclick: closeDetails }));
    const content = [top, el("h2", { id: "details-title", text: m.title }),
      el("p", { class: "d-row", text: `${longDay(m.date)} · ${span(m.start, m.duration)}` })];
    if (m.room_name) {
      content.push(el("p", { class: "d-row" }, `Room: ${m.room_name} `, m.room_declined ? el("span", { class: "declined", text: "(declined: already booked at this time)" }) : null));
    }
    content.push(el("p", { class: "d-row", text: `${m.guests.length + 1} ${m.guests.length ? "people" : "person"}` }), guests);
    if (m.description) content.push(el("p", { text: m.description }));
    if (!m.seeded) {
      const remove = el("button", { type: "button", class: "ghost", text: "Delete" });
      remove.addEventListener("click", async () => {
        if (remove.dataset.confirm !== "1") {
          remove.dataset.confirm = "1";
          remove.textContent = "Click again to delete";
          return;
        }
        const response = await fetch(`/api/meetings/${m.id}`, { method: "DELETE" });
        details.hidden = true;
        flash(response.ok ? "Meeting deleted. Guests were notified." : "Couldn’t delete the meeting.");
        loadWeek();
      });
      content.push(el("div", { class: "d-actions" }, remove,
        el("button", { type: "button", class: "primary", text: "Edit", onclick: () => { details.hidden = true; openEditor(m); } })));
    }
    details.replaceChildren(...content);
    details.hidden = false;
    details.querySelector("button").focus();
  }

  function fillStartOptions() {
    const select = $("start");
    for (let t = FIRST_HOUR * 60; t <= LAST_HOUR * 60; t += 15) {
      const value = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      select.append(el("option", { value, text: clock(t) }));
    }
  }

  function setError(name, message) {
    const box = $(`${name}-error`);
    const input = name === "attendees" ? guestInput : name === "room" ? null : $(name);
    box.textContent = message || "";
    box.hidden = !message;
    if (input) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function clearErrors() {
    for (const name of ["title", "date", "start", "duration", "attendees", "room"]) setError(name, "");
    $("form-error").hidden = true;
  }

  function updateWhen() {
    const date = $("date").value;
    $("when").textContent = date ? `${longDay(date)} · ${span($("start").value, Number($("duration").value))}` : "";
  }

  function renderGuests() {
    guestList.replaceChildren(...state.guests.map((g, i) => el("li", {},
      dot(g.name || g.email, g.photo_hue),
      el("div", { class: "g-text" }, el("div", {}, g.external ? g.email : g.name, g.external ? el("span", { class: "tag", text: "Guest" }) : null),
        el("div", { class: "g-sub", text: g.external ? "Outside Northwind" : `${g.email} · ${g.title}` })),
      el("button", { type: "button", class: "remove", "aria-label": `Remove ${g.name || g.email}`, text: "×", onclick: () => { state.guests.splice(i, 1); renderGuests(); guestInput.focus(); } }))));
    renderRooms();
  }

  function closeOptions() {
    options.hidden = true;
    guestInput.setAttribute("aria-expanded", "false");
    guestInput.removeAttribute("aria-activedescendant");
    state.active = -1;
  }

  function renderOptions() {
    if (!state.suggestions.length) {
      const q = guestInput.value.trim();
      options.replaceChildren(el("li", { class: "empty", role: "presentation", text: q ? "No one at Northwind matches. To invite a guest, type their full email address." : "" }));
    } else {
      options.replaceChildren(...state.suggestions.map((s, i) => el("li", { id: `opt-${i}`, role: "option", "aria-selected": i === state.active ? "true" : "false",
        onmousedown: (e) => { e.preventDefault(); addGuest(s); } },
        dot(s.external ? s.email : s.name, s.photo_hue),
        el("div", {}, el("div", { class: "o-name", text: s.external ? `Invite ${s.email}` : s.name }),
          el("div", { class: "o-sub", text: s.external ? "Guest outside Northwind" : `${s.email} · ${s.title}` })))));
    }
    options.hidden = false;
    guestInput.setAttribute("aria-expanded", "true");
    if (state.active >= 0) {
      guestInput.setAttribute("aria-activedescendant", `opt-${state.active}`);
      $(`opt-${state.active}`).scrollIntoView({ block: "nearest" });
    } else guestInput.removeAttribute("aria-activedescendant");
  }

  async function searchGuests() {
    const q = guestInput.value.trim();
    const seq = ++state.searchSeq;
    if (!q) {
      closeOptions();
      return;
    }
    const response = await fetch(`/api/people?q=${encodeURIComponent(q)}`);
    const people = await response.json();
    if (seq !== state.searchSeq) return;
    const taken = new Set(state.guests.map((g) => g.email));
    const list = people.filter((p) => !taken.has(p.email));
    const lower = q.toLowerCase();
    if (EMAIL.test(q) && !people.some((p) => p.email === lower) && !taken.has(lower) && lower !== ME) list.push({ email: lower, external: true });
    state.suggestions = list;
    state.active = list.length ? 0 : -1;
    renderOptions();
  }

  function addGuest(s) {
    if (!state.guests.some((g) => g.email === s.email)) state.guests.push(s);
    guestInput.value = "";
    state.suggestions = [];
    closeOptions();
    setError("attendees", "");
    renderGuests();
    guestInput.focus();
  }

  async function loadRooms() {
    const seq = ++state.roomSeq;
    const date = $("date").value;
    if (!date) {
      state.rooms = [];
      roomList.replaceChildren(el("p", { class: "msg", text: "Choose a date to see which rooms are free." }));
      return;
    }
    roomList.replaceChildren(el("p", { class: "msg", text: "Checking room availability…" }));
    const params = new URLSearchParams({ date, start: $("start").value, duration: $("duration").value });
    if (state.editing) params.set("meeting", state.editing);
    const response = await fetch(`/api/rooms?${params}`);
    if (seq !== state.roomSeq) return;
    state.rooms = response.ok ? await response.json() : [];
    renderRooms();
  }

  function renderRooms() {
    if (!$("date").value) return;
    const onlyScreen = $("f-screen").checked;
    const onlyFree = $("f-free").checked;
    const shown = state.rooms.filter((r) => (!onlyScreen || r.equipment.includes("Video screen")) && (!onlyFree || r.available));
    const people = state.guests.length + 1;
    $("room-count").textContent = `${shown.length} of ${state.rooms.length} rooms · ${people} ${people === 1 ? "person" : "people"} invited`;
    const radio = (value, checked) => {
      const input = el("input", { type: "radio", name: "room", value });
      input.checked = checked;
      input.addEventListener("change", () => { state.room = value; setError("room", ""); });
      return input;
    };
    const rows = [el("label", { class: "room" }, radio("", state.room === ""), el("div", {}, el("div", { class: "r-name", text: "No room" }), el("div", { class: "r-sub", text: "Video call only" })), el("span"))];
    for (const r of shown) {
      rows.push(el("label", { class: "room" }, radio(r.id, state.room === r.id),
        el("div", {}, el("div", { class: "r-name", text: r.name }),
          el("div", { class: "r-sub", text: `Floor ${r.floor} · Seats ${r.capacity} · ${r.equipment.join(", ")}` })),
        el("span", { class: `avail${r.available ? "" : " busy"}`, text: r.available ? "Available" : "Busy at this time" })));
    }
    if (!shown.length) rows.push(el("p", { class: "msg", text: "No rooms match these filters." }));
    roomList.replaceChildren(...rows);
  }

  function openEditor(m) {
    clearErrors();
    closeDetails.returnTo = document.activeElement;
    state.editing = m ? m.id : null;
    $("editor-title").textContent = m ? "Edit meeting" : "New meeting";
    $("title").value = m ? m.title : "";
    $("date").value = m ? m.date : TODAY;
    $("start").value = m ? m.start : "10:00";
    $("duration").value = String(m ? m.duration : 30);
    $("description").value = m ? m.description : "";
    state.guests = m ? m.guests.map((g) => (g.external ? { email: g.email, external: true } : { name: g.name, email: g.email, title: g.title, photo_hue: g.photo_hue })) : [];
    state.room = m ? m.room : "";
    $("f-screen").checked = false;
    $("f-free").checked = false;
    guestInput.value = "";
    closeOptions();
    renderGuests();
    updateWhen();
    loadRooms();
    editor.showModal();
    $("title").focus();
  }

  function closeEditor() {
    editor.close();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();
    const payload = {
      title: $("title").value,
      date: $("date").value,
      start: $("start").value,
      duration: Number($("duration").value),
      attendees: state.guests.map((g) => g.email),
      room: state.room,
      description: $("description").value,
    };
    const save = $("save");
    save.disabled = true;
    $("saving").textContent = "Saving…";
    try {
      const response = await fetch(state.editing ? `/api/meetings/${state.editing}` : "/api/meetings", {
        method: state.editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (response.status === 422) {
        for (const [name, message] of Object.entries(result.errors)) setError(name, message);
        $("form-error").textContent = "Fix the highlighted fields and save again.";
        $("form-error").hidden = false;
        const first = form.querySelector("[aria-invalid=true]");
        if (first) first.focus();
        return;
      }
      if (!response.ok) throw new Error(result.error);
      const wasEditing = Boolean(state.editing);
      closeEditor();
      state.week = mondayOf(result.date);
      await loadWeek();
      const guestCount = result.guests.length;
      let message = wasEditing ? "Meeting updated." : "Meeting saved.";
      if (guestCount) message += ` Invitations sent to ${guestCount} ${guestCount === 1 ? "guest" : "guests"}.`;
      if (result.room_declined) message += ` ${result.room_name} declined: it’s already booked at that time.`;
      flash(message);
    } catch {
      $("form-error").textContent = "Couldn’t save the meeting. Try again.";
      $("form-error").hidden = false;
    } finally {
      save.disabled = false;
      $("saving").textContent = "";
    }
  });

  let guestTimer = 0;
  guestInput.addEventListener("input", () => {
    clearTimeout(guestTimer);
    guestTimer = setTimeout(searchGuests, 150);
  });
  guestInput.addEventListener("keydown", (event) => {
    const open = !options.hidden && state.suggestions.length;
    if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      state.active = (state.active + 1) % state.suggestions.length;
      renderOptions();
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      state.active = (state.active - 1 + state.suggestions.length) % state.suggestions.length;
      renderOptions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && state.active >= 0) addGuest(state.suggestions[state.active]);
    } else if (event.key === "Escape" && !options.hidden) {
      event.preventDefault();
      closeOptions();
    }
  });
  guestInput.addEventListener("blur", () => setTimeout(closeOptions, 100));

  for (const id of ["date", "start", "duration"]) $(id).addEventListener("change", () => { updateWhen(); loadRooms(); });
  $("date").addEventListener("input", () => { updateWhen(); loadRooms(); });
  $("f-screen").addEventListener("change", renderRooms);
  $("f-free").addEventListener("change", renderRooms);
  $("cancel").addEventListener("click", closeEditor);
  $("cancel-x").addEventListener("click", closeEditor);
  $("create").addEventListener("click", () => { closeDetails(); openEditor(null); });
  $("today").addEventListener("click", () => { state.week = mondayOf(TODAY); loadWeek(); });
  $("prev").addEventListener("click", () => { state.week = addDays(state.week, -7); loadWeek(); });
  $("next").addEventListener("click", () => { state.week = addDays(state.week, 7); loadWeek(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !details.hidden) closeDetails(); });

  fillStartOptions();
  loadWeek();
})();
