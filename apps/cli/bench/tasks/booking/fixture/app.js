(function () {
  "use strict";

  const TODAY = "2026-11-06";
  const LAST_DAY = "2027-08-31";
  const STORE_KEY = "alder.booking.v2";
  const STEPS = [["search", "Search"], ["flights", "Choose flight"], ["travelers", "Travelers & seats"], ["review", "Review & pay"]];
  const FARE_FEATURES = {
    B: { seats: false, list: ["Seats assigned at check-in, so your party may not sit together", "Personal item only (carry-on $35)", "No changes or refunds", "Boards last"] },
    M: { seats: true, list: ["Choose your seats (standard seats included)", "Carry-on bag included", "Changes allowed, pay any fare difference", "Earns 5 points per $1"] },
    F: { seats: true, list: ["Choose your seats (standard seats included)", "Carry-on and first checked bag included", "Free changes, full refund to original payment", "Priority boarding"] },
    P: { seats: true, list: ["Choose your First seat", "Two checked bags included", "Changes allowed, pay any fare difference", "Lounge access on flights over 3 hours"] },
    R: { seats: true, list: ["Choose your First seat", "Two checked bags included", "Free changes, full refund", "Lounge access on flights over 3 hours"] }
  };
  const COUNTRY_CODES = [["+1", "United States / Canada (+1)"], ["+52", "Mexico (+52)"], ["+44", "United Kingdom (+44)"], ["+49", "Germany (+49)"], ["+61", "Australia (+61)"], ["+81", "Japan (+81)"], ["+91", "India (+91)"]];

  const main = document.getElementById("main");
  const live = document.getElementById("live");
  let airports = [];
  let state = load();
  let seatMapCache = null;

  function blankState() {
    return { search: { origin: "", destination: "", date: "", adults: 1, children: 0, cabin: "economy" }, flight: null, fare: null,
      passengers: [], contact: { email: "jordan@northwind.dev", country: "+1", phone: "" }, seats: [], exitAck: false, fareRules: false,
      price: null, booking: null };
  }

  function load() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(blankState(), JSON.parse(raw));
    } catch (e) {}
    return blankState();
  }

  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children || [])) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(c));
    return node;
  }

  function money(n) {
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  }

  function money2(n) {
    return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseISO(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function isoOf(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function longDate(iso) {
    return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function shortDate(iso) {
    return parseISO(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  }

  function time12(hhmm) {
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    return { t: `${h}:${String(m).padStart(2, "0")}`, ap };
  }

  function timeText(hhmm) {
    const x = time12(hhmm);
    return `${x.t} ${x.ap}`;
  }

  function duration(min) {
    return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
  }

  function cityOf(code) {
    const a = airports.find((x) => x.code === code);
    return a ? a.city : code;
  }

  function paxCount() {
    return Number(state.search.adults) + Number(state.search.children);
  }

  function say(text) {
    live.textContent = "";
    setTimeout(() => { live.textContent = text; }, 30);
  }

  function go(step) {
    if (location.hash === `#/${step}`) render();
    else location.hash = `#/${step}`;
  }

  function currentStep() {
    const step = location.hash.replace(/^#\//, "") || "search";
    if (step === "flights" && !state.search.destination) return "search";
    if ((step === "travelers" || step === "review") && !state.fare) return state.search.destination ? "flights" : "search";
    if (step === "review" && !state.price) return "travelers";
    if (step === "confirmation" && !state.booking) return "search";
    if (!["search", "flights", "travelers", "review", "confirmation"].includes(step)) return "search";
    return step;
  }

  function renderProgress(step) {
    const ol = document.getElementById("progress");
    ol.replaceChildren();
    const idx = step === "confirmation" ? STEPS.length : STEPS.findIndex((s) => s[0] === step);
    STEPS.forEach(([, label], i) => {
      ol.append(el("li", { class: i < idx ? "done" : "", "aria-current": i === idx ? "step" : null }, [el("span", { class: "n", text: i < idx ? "✓" : String(i + 1) }), label]));
    });
  }

  function render() {
    const step = currentStep();
    renderProgress(step);
    main.replaceChildren();
    ({ search: renderSearch, flights: renderFlights, travelers: renderTravelers, review: renderReview, confirmation: renderConfirmation })[step]();
    document.title = ({ search: "Book a flight", flights: "Choose your flight", travelers: "Travelers and seats", review: "Review and pay", confirmation: "Booking confirmed" })[step] + " · Alder Air";
    window.scrollTo(0, 0);
  }

  function fieldError(id, message) {
    return message ? el("p", { class: "field-error", id: `${id}-error`, text: message }) : null;
  }

  function errorSummary(errors) {
    if (!errors.length) return null;
    const box = el("div", { class: "error-summary", role: "alert", tabindex: "-1" }, [
      el("h2", { text: errors.length === 1 ? "There's a problem with your booking" : `There are ${errors.length} problems with your booking` }),
      el("ul", {}, errors.map((e) => el("li", {}, el("a", { href: `#${e.target}`, text: e.message, onclick: (ev) => { ev.preventDefault(); const t = document.getElementById(e.target); if (t) { t.focus(); t.scrollIntoView({ block: "center" }); } } }))))
    ]);
    setTimeout(() => box.focus(), 0);
    return box;
  }

  function markInvalid(input, message) {
    if (!message) return;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${input.id}-error`);
  }

  function renderSearch() {
    const s = renderSearch.draft || state.search;
    renderSearch.draft = null;
    const errors = renderSearch.errors || {};
    const list = Object.entries(errors).map(([k, message]) => ({ target: k, message }));
    renderSearch.errors = null;
    const origin = el("select", { id: "origin", name: "origin", required: true }, [el("option", { value: "", text: "Select origin" })]);
    airports.forEach((a) => origin.append(el("option", { value: a.code, text: `${a.city} (${a.code})`, selected: a.code === s.origin })));
    const destination = el("select", { id: "destination", name: "destination", required: true });
    const fillDestinations = () => {
      destination.replaceChildren(el("option", { value: "", text: origin.value ? "Select destination" : "Choose an origin first" }));
      const from = airports.find((a) => a.code === origin.value);
      destination.disabled = !from;
      if (!from) return;
      from.routes.map((c) => airports.find((a) => a.code === c)).filter(Boolean).sort((a, b) => a.city.localeCompare(b.city))
        .forEach((a) => destination.append(el("option", { value: a.code, text: `${a.city} (${a.code})`, selected: a.code === s.destination && origin.value === s.origin })));
    };
    origin.addEventListener("change", () => { fillDestinations(); destination.value = ""; });
    fillDestinations();
    const dateInput = el("input", { type: "date", id: "depart", name: "depart", min: TODAY, max: LAST_DAY, value: s.date, required: true });
    const adults = el("select", { id: "adults", name: "adults" }, [1, 2, 3, 4, 5, 6, 7].map((n) => el("option", { value: n, text: `${n} adult${n > 1 ? "s" : ""}`, selected: Number(s.adults) === n })));
    const children = el("select", { id: "children", name: "children" }, [0, 1, 2, 3, 4, 5, 6].map((n) => el("option", { value: n, text: n === 0 ? "No children" : `${n} child${n > 1 ? "ren" : ""} (2–17)`, selected: Number(s.children) === n })));
    const cabin = el("select", { id: "cabin", name: "cabin" }, [["economy", "Economy"], ["first", "First"]].map(([v, t]) => el("option", { value: v, text: t, selected: s.cabin === v })));
    [[origin, errors.origin], [destination, errors.destination], [dateInput, errors.depart], [adults, errors.adults]].forEach(([i, m]) => markInvalid(i, m));
    const form = el("form", { novalidate: true, onsubmit: (ev) => {
      ev.preventDefault();
      const found = {};
      if (!origin.value) found.origin = "Choose where you're flying from.";
      if (!destination.value) found.destination = "Choose where you're flying to.";
      if (!dateInput.value) found.depart = "Choose a departure date.";
      else if (dateInput.value < TODAY || dateInput.value > LAST_DAY) found.depart = "Choose a date between today and Aug 31, 2027.";
      if (Number(adults.value) + Number(children.value) > 7) found.adults = "You can book up to 7 travelers at once.";
      if (Object.keys(found).length) {
        renderSearch.errors = found;
        renderSearch.draft = { origin: origin.value, destination: destination.value, date: dateInput.value, adults: Number(adults.value), children: Number(children.value), cabin: cabin.value };
        return render();
      }
      const was = state.search;
      const changed = origin.value !== was.origin || destination.value !== was.destination || dateInput.value !== was.date || cabin.value !== was.cabin || Number(adults.value) + Number(children.value) !== paxCount();
      state.search = { origin: origin.value, destination: destination.value, date: dateInput.value, adults: Number(adults.value), children: Number(children.value), cabin: cabin.value };
      if (changed) Object.assign(state, { flight: null, fare: null, seats: [], exitAck: false, price: null, fareRules: false });
      save();
      go("flights");
    } }, [
      el("div", { class: "search-grid" }, [
        el("div", { class: "field" }, [el("label", { for: "origin", text: "From" }), origin, fieldError("origin", errors.origin)]),
        el("div", { class: "field" }, [el("label", { for: "destination", text: "To" }), destination, fieldError("destination", errors.destination)]),
        el("div", { class: "field" }, [el("label", { for: "depart", text: "Depart" }), dateInput, fieldError("depart", errors.depart)]),
        el("div", { class: "field" }, [el("label", { for: "adults", text: "Adults (18+)" }), adults, fieldError("adults", errors.adults)]),
        el("div", { class: "field" }, [el("label", { for: "children", text: "Children" }), children]),
        el("div", { class: "field" }, [el("label", { for: "cabin", text: "Cabin" }), cabin])
      ]),
      el("div", { class: "actions", style: "padding-bottom:20px" }, [el("p", { class: "hint", style: "color:#d5e6ea", text: "One-way fares. Book up to 7 travelers." }), el("button", { class: "btn gold", type: "submit", text: "Find flights" })])
    ]);
    main.append(
      el("section", { class: "hero", "aria-labelledby": "search-title" }, [el("h1", { id: "search-title", text: "Where to next?" }), el("p", { text: "Low fares up and down the West Coast, with seat selection included on Main." }), errorSummary(list), form]),
      el("div", { class: "promo-row" }, [
        el("div", { class: "promo" }, [el("strong", { text: "Holiday travel is filling up" }), el("p", { text: "Book Thanksgiving and December trips early for the best Main fares." })]),
        el("div", { class: "promo" }, [el("strong", { text: "New: Paine Field nonstops" }), el("p", { text: "Fly into Everett from San Francisco, San Diego, Las Vegas and Phoenix." })]),
        el("div", { class: "promo" }, [el("strong", { text: "Ridge status perks" }), el("p", { text: "Ridge members get free standard seats on every fare except Basic." })])
      ])
    );
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ headers: { "Content-Type": "application/json" } }, options || {}));
    let body = null;
    try { body = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, body: body || {} };
  }

  function loading(text) {
    return el("div", { class: "loading", role: "status" }, [el("span", { class: "spinner", "aria-hidden": "true" }), text]);
  }

  async function renderFlights() {
    const s = state.search;
    const header = el("div", { class: "trip-head" }, [
      el("div", {}, [el("h1", { text: `${cityOf(s.origin)} to ${cityOf(s.destination)}` }), el("p", { text: `${s.origin} → ${s.destination} · ${longDate(s.date)} · ${paxCount()} traveler${paxCount() > 1 ? "s" : ""} · ${s.cabin === "first" ? "First" : "Economy"}` })]),
      el("a", { class: "btn", href: "#/search", text: "Modify search" })
    ]);
    const strip = el("div", { class: "date-strip", role: "group", "aria-label": "Nearby dates" });
    for (let d = -3; d <= 3; d++) {
      const day = new Date(parseISO(s.date).getTime() + d * 86400000);
      const iso = isoOf(day);
      strip.append(el("button", { type: "button", "aria-current": d === 0 ? "date" : null, disabled: iso < TODAY || iso > LAST_DAY, text: shortDate(iso),
        onclick: () => { state.search.date = iso; Object.assign(state, { flight: null, fare: null, seats: [], price: null, exitAck: false }); save(); render(); } }));
    }
    const sort = el("select", { id: "sort" }, [["recommended", "Recommended"], ["price", "Lowest price"], ["depart", "Departure time"], ["arrive", "Arrival time"], ["duration", "Shortest travel time"]].map(([v, t]) => el("option", { value: v, text: t, selected: (renderFlights.sort || "recommended") === v })));
    const nonstop = el("input", { type: "checkbox", id: "nonstop", checked: !!renderFlights.nonstop });
    const count = el("span", { class: "count", role: "status" });
    const list = el("div", { id: "flight-list" }, loading("Finding flights…"));
    main.append(header, strip, el("div", { class: "toolbar" }, [el("label", { for: "sort", class: "label", text: "Sort by" }), sort, el("label", { class: "check" }, [nonstop, "Nonstop only"]), count]), list);
    const res = await api(`/api/availability?origin=${s.origin}&destination=${s.destination}&date=${s.date}&adults=${s.adults}&children=${s.children}&cabin=${s.cabin}`);
    if (!res.ok) { list.replaceChildren(el("div", { class: "notice", text: res.body.error || "We couldn't load flights. Try again." })); return; }
    const flights = res.body.flights;
    const draw = () => {
      renderFlights.sort = sort.value;
      renderFlights.nonstop = nonstop.checked;
      const minFare = (f) => Math.min(...f.fares.filter((x) => !x.sold_out).map((x) => x.price).concat([99999]));
      const score = (f) => minFare(f) + f.duration_min * 0.35 + (f.stops ? 25 : 0);
      const sorters = { recommended: (a, b) => score(a) - score(b), price: (a, b) => minFare(a) - minFare(b), depart: (a, b) => a.depart.localeCompare(b.depart),
        arrive: (a, b) => (a.arrive_next_day - b.arrive_next_day) || a.arrive.localeCompare(b.arrive), duration: (a, b) => a.duration_min - b.duration_min };
      const shown = flights.filter((f) => !nonstop.checked || f.stops === 0).sort(sorters[sort.value]);
      count.textContent = `${shown.length} of ${flights.length} flights`;
      const fareNames = flights[0] ? flights[0].fares.map((f) => f.name) : [];
      const two = fareNames.length === 2 ? " two" : "";
      list.replaceChildren(el("div", { class: "fare-head" + two, "aria-hidden": "true" }, [el("span", { style: "text-align:left", text: "Flights" })].concat(fareNames.map((n) => el("span", { text: n })))));
      if (!shown.length) list.append(el("div", { class: "notice info", text: "No flights match your filters." }));
      shown.forEach((f) => list.append(flightCard(f, two)));
    };
    sort.addEventListener("change", draw);
    nonstop.addEventListener("change", draw);
    draw();
  }

  function flightCard(f, two) {
    const dep = time12(f.depart), arr = time12(f.arrive);
    const stopText = f.stops ? `1 stop · ${f.connection.airport} (${duration(f.connection.layover_min)} layover)` : "Nonstop";
    const selectedHere = state.flight && state.flight.id === f.id;
    const card = el("article", { class: "flight", "aria-label": `${f.number}, departs ${dep.t} ${dep.ap}, ${f.stops ? "1 stop" : "nonstop"}` });
    const row = el("div", { class: "flight-row" + two }, [
      el("div", {}, [
        el("div", { class: "times" }, [
          el("div", {}, [el("span", { class: "t", text: dep.t }), " ", el("span", { class: "ap", text: dep.ap }), el("div", { class: "meta", text: f.origin })]),
          el("div", { class: "line", text: duration(f.duration_min) }),
          el("div", {}, [el("span", { class: "t", text: arr.t }), " ", el("span", { class: "ap", text: arr.ap + (f.arrive_next_day ? " +1" : "") }), el("div", { class: "meta", text: f.destination })])
        ]),
        el("div", { class: "meta" }, [el("span", { class: f.stops ? "stops-1" : "stops-0", text: stopText }), ` · ${f.number.replace("AQ", "AQ ")} · ${f.aircraft}`])
      ])
    ]);
    f.fares.forEach((fare) => {
      const pressed = selectedHere && state.fare && state.fare.code === fare.code;
      row.append(el("button", { type: "button", class: "fare-btn", "aria-pressed": pressed ? "true" : "false", disabled: fare.sold_out,
        "aria-label": fare.sold_out ? `${fare.name} sold out` : `${fare.name} ${money(fare.price)} per person`,
        onclick: () => { state.flight = f; state.fare = fare; state.seats = []; state.exitAck = false; state.price = null; save(); say(`${fare.name} selected on ${f.number}`); const y = window.scrollY; renderFlightsRedraw(); window.scrollTo(0, y); } },
        fare.sold_out ? [el("span", { class: "p", text: "—" }), el("small", { text: "Sold out" })] : [el("span", { class: "p", text: money(fare.price) }), el("small", { class: fare.seats_left ? "left" : "", text: fare.seats_left ? `${fare.seats_left} left at this price` : "per person" })]));
    });
    card.append(row);
    if (selectedHere && state.fare) {
      const feats = FARE_FEATURES[state.fare.code];
      card.append(el("div", { class: "fare-detail" }, [
        el("div", {}, [el("h3", { text: `${state.fare.name} · ${money(state.fare.price)} per person` }), el("ul", {}, feats.list.map((t) => el("li", { text: t }))),
          !feats.seats ? el("div", { class: "notice", text: "Basic doesn't let you choose seats. Want to sit together? Choose Main." }) : null]),
        el("button", { type: "button", class: "btn primary", text: `Continue with ${state.fare.name}`, onclick: () => go("travelers") })
      ]));
    }
    return card;
  }

  function renderFlightsRedraw() {
    const sort = document.getElementById("sort");
    if (sort) sort.dispatchEvent(new Event("change"));
  }

  function ensurePassengers() {
    const n = paxCount();
    while (state.passengers.length < n) state.passengers.push({ first: "", middle: "", no_middle: false, last: "", dob: "", ktn: "" });
    state.passengers.length = n;
    while (state.seats.length < n) state.seats.push(null);
    state.seats.length = n;
  }

  function dobToISO(text) {
    const m = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [mm, dd, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd || yyyy < 1900) return null;
    const iso = isoOf(d);
    return iso < TODAY ? iso : null;
  }

  function paxLabel(i) {
    const p = state.passengers[i];
    const name = [p.first, p.last].filter(Boolean).join(" ");
    return name || `Passenger ${i + 1}`;
  }

  function fieldIdForServer(field) {
    const m = field.match(/^passengers\.(\d+)\.(\w+)$/);
    if (m) return `p${m[1]}-${m[2]}`;
    const s = field.match(/^seats\.(\d+)$/);
    if (s) return "seatmap";
    return { "contact.email": "email", "contact.phone": "phone", exit_ack: "exit-ack", fare_rules: "fare-rules", flight: "main", passengers: "main" }[field] || "main";
  }

  function collectTravelerErrors() {
    const errs = [];
    state.passengers.forEach((p, i) => {
      if (!p.first.trim()) errs.push({ target: `p${i}-first`, message: `Passenger ${i + 1}: enter the first name as on the ID.` });
      if (!p.middle.trim() && !p.no_middle) errs.push({ target: `p${i}-middle`, message: `Passenger ${i + 1}: enter the middle name as on the ID, or select “No middle name on ID”.` });
      if (!p.last.trim()) errs.push({ target: `p${i}-last`, message: `Passenger ${i + 1}: enter the last name as on the ID.` });
      if (!p.dob.trim()) errs.push({ target: `p${i}-dob`, message: `Passenger ${i + 1}: enter a date of birth.` });
      else if (!dobToISO(p.dob)) errs.push({ target: `p${i}-dob`, message: `Passenger ${i + 1}: enter the date of birth as MM/DD/YYYY.` });
    });
    if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(state.contact.email.trim())) errs.push({ target: "email", message: "Enter a valid email address, like name@example.com." });
    if (!state.contact.phone.trim()) errs.push({ target: "phone", message: "Enter a mobile number for flight updates." });
    if (FARE_FEATURES[state.fare.code].seats) state.seats.forEach((s, i) => { if (!s) errs.push({ target: "seatmap", message: `Choose a seat for ${paxLabel(i)}.` }); });
    if (exitSeatChosen() && !state.exitAck) errs.push({ target: "exit-ack", message: "Confirm that passengers seated in an exit row meet the exit row requirements." });
    return errs;
  }

  function exitSeatChosen() {
    if (!seatMapCache) return false;
    return state.seats.some((id) => id && seatMapCache.rows.some((r) => r.kind === "exit" && r.seats.some((s) => s.id === id)));
  }

  function seatFee(id) {
    if (!seatMapCache || !id) return 0;
    const row = seatMapCache.rows.find((r) => r.seats.some((s) => s.id === id));
    return row ? row.fee : 0;
  }

  function priceBox() {
    const fare = state.fare;
    const n = paxCount();
    const seats = state.seats.reduce((sum, id) => sum + seatFee(id), 0);
    const base = fare.price * n;
    const taxes = Math.round((base * 0.075 + n * (5.6 + 4.5 * (1 + state.flight.stops))) * 100) / 100;
    return el("section", { class: "card summary", "aria-label": "Trip summary" }, [
      el("h2", { text: "Trip summary" }),
      el("p", { class: "hint", text: `${state.flight.number.replace("AQ", "AQ ")} · ${shortDate(state.flight.date)} · ${timeText(state.flight.depart)} → ${timeText(state.flight.arrive)}` }),
      el("p", { class: "hint", style: "margin-bottom:12px", text: `${state.flight.origin} → ${state.flight.destination} · ${state.flight.stops ? "1 stop" : "Nonstop"} · ${fare.name}` }),
      el("dl", {}, [el("dt", { text: `${fare.name} fare × ${n}` }), el("dd", { text: money2(base) }), el("dt", { text: "Taxes and fees" }), el("dd", { text: money2(taxes) }),
        el("dt", { text: "Seats" }), el("dd", { text: seats ? money2(seats) : "Included" }), el("dt", { class: "total", text: "Total" }), el("dd", { class: "total", text: money2(base + taxes + seats) })])
    ]);
  }

  async function renderTravelers() {
    ensurePassengers();
    const errors = renderTravelers.errors || [];
    renderTravelers.errors = null;
    const errFor = (id) => (errors.find((e) => e.target === id) || {}).message;
    const left = el("div");
    const layout = el("div", { class: "layout" }, [left, priceBox()]);
    main.append(el("h1", { text: "Who's flying?" }), errorSummary(errors), layout);
    left.append(el("p", { class: "hint", style: "margin:-6px 0 14px", text: "Enter each name exactly as it appears on the government-issued photo ID the passenger will travel with. Names can't be changed after booking." }));
    state.passengers.forEach((p, i) => {
      const input = (key, label, attrs) => {
        const id = `p${i}-${key}`;
        const node = el("input", Object.assign({ type: "text", id, value: p[key], autocomplete: "off", spellcheck: "false" }, attrs || {}));
        node.addEventListener("input", () => { p[key] = node.value; save(); if (key === "first" || key === "last") refreshSeatPickers(); });
        markInvalid(node, errFor(id));
        return node;
      };
      const middle = input("middle", "Middle name", { disabled: p.no_middle });
      const noMiddle = el("input", { type: "checkbox", id: `p${i}-nomiddle`, checked: p.no_middle });
      noMiddle.addEventListener("change", () => { p.no_middle = noMiddle.checked; if (p.no_middle) { p.middle = ""; middle.value = ""; } middle.disabled = p.no_middle; save(); });
      const type = i < Number(state.search.adults) ? "Adult" : "Child";
      left.append(el("section", { class: "card", "aria-labelledby": `p${i}-title` }, [
        el("h2", { id: `p${i}-title`, text: `Passenger ${i + 1} · ${type}${i === 0 ? " · Primary contact" : ""}` }),
        el("div", { class: "pax-grid" }, [
          el("div", { class: "field" }, [el("label", { for: `p${i}-first`, text: "First name (as on ID)" }), input("first", "", { autocomplete: i === 0 ? "given-name" : "off" }), fieldError(`p${i}-first`, errFor(`p${i}-first`))]),
          el("div", { class: "field" }, [el("label", { for: `p${i}-middle`, text: "Middle name (as on ID)" }), middle, el("label", { class: "check" }, [noMiddle, "No middle name on ID"]), fieldError(`p${i}-middle`, errFor(`p${i}-middle`))]),
          el("div", { class: "field" }, [el("label", { for: `p${i}-last`, text: "Last name (as on ID)" }), input("last", "", { autocomplete: i === 0 ? "family-name" : "off" }), fieldError(`p${i}-last`, errFor(`p${i}-last`))]),
          el("div", { class: "field" }, [el("label", { for: `p${i}-dob`, text: "Date of birth" }), input("dob", "", { placeholder: "MM/DD/YYYY", inputmode: "numeric" }), el("p", { class: "hint", id: `p${i}-dob-hint`, text: "MM/DD/YYYY" }), fieldError(`p${i}-dob`, errFor(`p${i}-dob`))]),
          el("div", { class: "field span2" }, [el("label", { for: `p${i}-ktn`, text: "Known Traveler Number (optional)" }), input("ktn", ""), el("p", { class: "hint", text: "TSA PreCheck or Global Entry number" })])
        ])
      ]));
    });
    const email = el("input", { type: "email", id: "email", value: state.contact.email, autocomplete: "email" });
    email.addEventListener("input", () => { state.contact.email = email.value; save(); });
    const country = el("select", { id: "country", "aria-label": "Country code" }, COUNTRY_CODES.map(([v, t]) => el("option", { value: v, text: t, selected: state.contact.country === v })));
    country.addEventListener("change", () => { state.contact.country = country.value; save(); });
    const phone = el("input", { type: "tel", id: "phone", value: state.contact.phone, autocomplete: "tel-national", placeholder: "415-555-0123" });
    phone.addEventListener("input", () => { state.contact.phone = phone.value; save(); });
    markInvalid(email, errFor("email"));
    markInvalid(phone, errFor("phone"));
    left.append(el("section", { class: "card", "aria-labelledby": "contact-title" }, [
      el("h2", { id: "contact-title", text: "Contact details" }),
      el("p", { class: "hint", style: "margin-bottom:12px", text: "We'll send the confirmation and any schedule changes here." }),
      el("div", { class: "pax-grid" }, [
        el("div", { class: "field" }, [el("label", { for: "email", text: "Email" }), email, fieldError("email", errFor("email"))]),
        el("div", { class: "field span2" }, [el("label", { for: "phone", text: "Mobile number" }), el("div", { class: "phone-row" }, [country, phone]), el("p", { class: "hint", text: "Choose the country code, then enter the number." }), fieldError("phone", errFor("phone"))])
      ])
    ]));
    const seatsSection = el("section", { class: "card", "aria-labelledby": "seat-title", id: "seat-section" }, [el("h2", { id: "seat-title", text: "Choose seats" })]);
    left.append(seatsSection);
    const cont = el("button", { type: "button", class: "btn primary", text: "Continue to review" });
    left.append(el("div", { class: "actions" }, [el("a", { href: "#/flights", text: "‹ Back to flights" }), cont]));
    if (!FARE_FEATURES[state.fare.code].seats) {
      seatsSection.append(el("div", { class: "notice", text: "Seat selection isn't included with Basic. Seats are assigned at check-in and your party may be seated apart." }), el("button", { type: "button", class: "btn", text: "Change fare", onclick: () => go("flights") }));
    } else {
      seatsSection.append(loading("Loading seat map…"));
      if (!seatMapCache || seatMapCache.flight !== state.flight.id) {
        const res = await api(`/api/seatmap?flight=${encodeURIComponent(state.flight.id)}`);
        seatMapCache = res.ok ? res.body : null;
      }
      drawSeatMap(seatsSection, errFor("seatmap"), errFor("exit-ack"));
      layout.replaceChild(priceBox(), layout.lastChild);
    }
    cont.addEventListener("click", async () => {
      const found = collectTravelerErrors();
      if (found.length) { renderTravelers.errors = found; return render(); }
      cont.disabled = true;
      cont.textContent = "Checking details…";
      const res = await api("/api/passengers/validate", { method: "POST", body: JSON.stringify(bookingPayload()) });
      if (!res.ok) {
        renderTravelers.errors = (res.body.errors || [{ field: "main", message: "Something went wrong. Please try again." }]).map((e) => ({ target: fieldIdForServer(e.field), message: e.message }));
        return render();
      }
      state.price = res.body.price;
      save();
      go("review");
    });
  }

  function bookingPayload() {
    return {
      flight: state.flight.id, cabin: state.search.cabin, fare: state.fare.code,
      passengers: state.passengers.map((p) => ({ first: p.first.trim(), middle: p.no_middle ? "" : p.middle.trim(), no_middle: p.no_middle, last: p.last.trim(), dob: dobToISO(p.dob) || p.dob.trim(), known_traveler: p.ktn.trim() })),
      contact: { email: state.contact.email.trim(), country: state.contact.country, phone: state.contact.phone.trim() },
      seats: state.seats.map((s) => s || ""), exit_ack: state.exitAck, fare_rules: state.fareRules
    };
  }

  let activePassenger = 0;

  function refreshSeatPickers() {
    document.querySelectorAll("[data-pax-label]").forEach((n) => {
      const i = Number(n.getAttribute("data-pax-label"));
      n.textContent = `${paxLabel(i)} — ${state.seats[i] ? "Seat " + state.seats[i] : "no seat yet"}`;
    });
  }

  function drawSeatMap(section, seatError, exitError) {
    section.replaceChildren(el("h2", { id: "seat-title", text: "Choose seats" }));
    if (!seatMapCache) { section.append(el("div", { class: "notice", text: "The seat map isn't available right now. Please try again." })); return; }
    const cabinKind = state.search.cabin === "first" ? "first" : "economy";
    const picker = el("fieldset", { class: "seat-pick" }, [el("legend", { class: "sr", text: "Choose a seat for" })]);
    state.passengers.forEach((p, i) => {
      const radio = el("input", { type: "radio", name: "seat-for", value: i, checked: i === activePassenger });
      radio.addEventListener("change", () => { activePassenger = i; });
      picker.append(el("label", {}, [radio, el("span", { "data-pax-label": i, text: "" })]));
    });
    section.append(el("p", { class: "hint", style: "margin-bottom:10px", text: "Select a traveler, then a seat. Standard seats are included with your fare." }), picker,
      el("ul", { class: "legend", "aria-label": "Seat map legend" }, [
        el("li", {}, [el("span", { class: "sw" }), "Standard (included)"]), el("li", {}, [el("span", { class: "sw pref" }), "Preferred +$25"]),
        el("li", {}, [el("span", { class: "sw exit" }), "Exit row +$39"]), el("li", {}, [el("span", { class: "sw occ" }), "Occupied"]),
        el("li", {}, [el("span", { class: "sw sel" }), "Your selection"]), el("li", {}, "A and F are window seats · C and D are aisle seats")
      ]), fieldError("seatmap", seatError));
    const table = el("table", { class: "seat-table", id: "seatmap", tabindex: "-1", "aria-label": `Seat map, ${seatMapCache.aircraft}, front of plane at top` });
    const firstRows = seatMapCache.rows.filter((r) => r.kind === "first");
    const econRows = seatMapCache.rows.filter((r) => r.kind !== "first");
    const head = (letters) => el("tr", {}, [el("th", { class: "pos", text: "" })].concat(letters.map((l, k) => [k === letters.length / 2 ? el("td", { class: "aisle", text: "" }) : null, el("th", { scope: "col", text: l })]).flat().filter(Boolean)).concat([el("th", { class: "pos", text: "" })]));
    const posRow = (letters) => el("tr", { "aria-hidden": "true" }, [el("th", { class: "pos" })].concat(letters.map((l, k) => [k === letters.length / 2 ? el("td", { class: "aisle" }) : null, el("th", { class: "pos", text: l === "A" || l === "F" ? "Window" : l === "C" || l === "D" ? "Aisle" : "" })]).flat().filter(Boolean)).concat([el("th", { class: "pos" })]));
    const body = el("tbody");
    const seatRow = (r, letters) => {
      const tr = el("tr");
      tr.append(r.kind === "exit" ? el("td", { class: "exit", text: "EXIT" }) : el("th", { scope: "row", text: r.row }));
      letters.forEach((letter, k) => {
        if (k === letters.length / 2) tr.append(el("td", { class: "aisle", text: r.kind === "exit" ? r.row : "" }));
        const s = r.seats.find((x) => x.letter === letter);
        const mine = state.seats.indexOf(s.id);
        const usable = s.available && (r.kind === "first") === (cabinKind === "first");
        const desc = [`Seat ${s.id}`, s.position, r.kind === "exit" ? "exit row, $39" : r.kind === "preferred" ? "preferred, $25" : r.kind === "first" ? "First" : "standard, included",
          mine >= 0 ? `selected for ${paxLabel(mine)}` : s.available ? (usable ? "available" : "not available with your fare") : "occupied"].join(", ");
        const btn = el("button", { type: "button", class: `seat ${r.kind}${mine >= 0 ? " taken" : ""}`, disabled: !usable && mine < 0, "aria-label": desc, "aria-pressed": mine >= 0 ? "true" : "false", text: mine >= 0 ? String(mine + 1) : s.available && usable ? letter : "×",
          onclick: () => pickSeat(s.id, section) });
        tr.append(el("td", {}, btn));
      });
      tr.append(r.kind === "exit" ? el("td", { class: "exit", text: "EXIT" }) : el("th", { scope: "row", text: r.row }));
      return tr;
    };
    const thead = el("thead", {}, [head(["A", "C", "D", "F"])]);
    body.append(el("tr", { class: "cabin-break" }, el("td", { colspan: 9, text: "First" })));
    firstRows.forEach((r) => body.append(seatRow(r, ["A", "C", "D", "F"])));
    body.append(el("tr", { class: "cabin-break" }, el("td", { colspan: 9, text: "Economy" })), head(["A", "B", "C", "D", "E", "F"]), posRow(["A", "B", "C", "D", "E", "F"]));
    econRows.forEach((r) => body.append(seatRow(r, ["A", "B", "C", "D", "E", "F"])));
    table.append(thead, body);
    section.append(el("div", { class: "plane" }, table));
    if (exitSeatChosen()) {
      const ack = el("input", { type: "checkbox", id: "exit-ack", checked: state.exitAck });
      markInvalid(ack, exitError);
      ack.addEventListener("change", () => { state.exitAck = ack.checked; save(); });
      section.append(el("div", { class: "exit-box", role: "group", "aria-labelledby": "exit-title" }, [
        el("h3", { id: "exit-title", text: "Exit row requirements" }),
        el("p", { style: "margin:0;font-size:14px", text: "Passengers in an exit row must:" }),
        el("ul", {}, ["Be at least 15 years old", "Be willing and able to open the exit door and help others in an emergency", "Read and speak English", "Not be traveling with a pet or infant"].map((t) => el("li", { text: t }))),
        el("label", { class: "check" }, [ack, "I confirm that each passenger seated in an exit row meets these requirements."]), fieldError("exit-ack", exitError)
      ]));
    } else {
      state.exitAck = false;
    }
    refreshSeatPickers();
  }

  function pickSeat(id, section) {
    const holder = state.seats.indexOf(id);
    if (holder === activePassenger) state.seats[activePassenger] = null;
    else if (holder >= 0) { say(`Seat ${id} is already selected for ${paxLabel(holder)}.`); return; }
    else {
      state.seats[activePassenger] = id;
      say(`Seat ${id} selected for ${paxLabel(activePassenger)}.`);
      const next = state.seats.findIndex((s) => !s);
      if (next >= 0) activePassenger = next;
    }
    state.price = null;
    save();
    const scrollY = window.scrollY;
    drawSeatMap(section, null, null);
    const layout = section.closest(".layout");
    layout.replaceChild(priceBox(), layout.lastChild);
    window.scrollTo(0, scrollY);
  }

  function renderReview() {
    const errors = renderReview.errors || [];
    renderReview.errors = null;
    const errFor = (id) => (errors.find((e) => e.target === id) || {}).message;
    const f = state.flight, price = state.price;
    const rules = el("input", { type: "checkbox", id: "fare-rules", checked: state.fareRules });
    markInvalid(rules, errFor("fare-rules"));
    rules.addEventListener("change", () => { state.fareRules = rules.checked; save(); });
    const confirmBtn = el("button", { type: "button", class: "btn primary", text: `Confirm and pay ${money2(price.total)}` });
    const otherErrors = errors.filter((e) => e.target !== "fare-rules");
    main.append(el("h1", { text: "Review your trip" }), errorSummary(errors),
      otherErrors.length ? el("div", { class: "notice" }, [el("a", { href: "#/travelers", text: "Edit travelers and seats" }), " to fix the details above."]) : null,
      el("section", { class: "card", "aria-labelledby": "rv-flight" }, [
        el("div", { class: "trip-head" }, [el("h2", { id: "rv-flight", text: `${cityOf(f.origin)} to ${cityOf(f.destination)}` }), el("a", { href: "#/flights", text: "Change flight" })]),
        el("dl", { class: "review-grid" }, [
          el("div", {}, [el("dt", { text: "Date" }), el("dd", { text: longDate(f.date) })]),
          el("div", {}, [el("dt", { text: "Flight" }), el("dd", { text: `${f.number.replace("AQ", "AQ ")} · ${f.aircraft}` })]),
          el("div", {}, [el("dt", { text: "Departs" }), el("dd", { text: `${timeText(f.depart)} from ${f.origin}` })]),
          el("div", {}, [el("dt", { text: "Arrives" }), el("dd", { text: `${timeText(f.arrive)}${f.arrive_next_day ? " (next day)" : ""} at ${f.destination}` })]),
          el("div", {}, [el("dt", { text: "Stops" }), el("dd", { text: f.stops ? `1 stop in ${f.connection.airport}` : "Nonstop" })]),
          el("div", {}, [el("dt", { text: "Fare" }), el("dd", { text: `${state.fare.name} · ${money(state.fare.price)} per person` })])
        ])
      ]),
      el("section", { class: "card", "aria-labelledby": "rv-pax" }, [
        el("div", { class: "trip-head" }, [el("h2", { id: "rv-pax", text: "Travelers" }), el("a", { href: "#/travelers", text: "Edit travelers and seats" })]),
        el("table", { class: "plain" }, [el("thead", {}, el("tr", {}, ["Name (as on ID)", "Date of birth", "Seat"].map((t) => el("th", { scope: "col", text: t })))),
          el("tbody", {}, state.passengers.map((p, i) => el("tr", {}, [el("td", { text: [p.first, p.no_middle ? "" : p.middle, p.last].filter(Boolean).join(" ") }), el("td", { text: p.dob }), el("td", { text: state.seats[i] || (FARE_FEATURES[state.fare.code].seats ? "—" : "Assigned at check-in") })])))]),
        el("p", { class: "hint", style: "margin-top:12px", text: `Contact: ${state.contact.email} · ${state.contact.country} ${state.contact.phone}` })
      ]),
      el("section", { class: "card", "aria-labelledby": "rv-price" }, [
        el("h2", { id: "rv-price", text: "Price" }),
        el("table", { class: "plain" }, el("tbody", {}, [
          el("tr", {}, [el("td", { text: `${state.fare.name} fare × ${paxCount()}` }), el("td", { style: "text-align:right", text: money2(price.fare_total) })]),
          el("tr", {}, [el("td", { text: "Taxes, fees and charges" }), el("td", { style: "text-align:right", text: money2(price.taxes) })]),
          el("tr", {}, [el("td", { text: "Seat selection" }), el("td", { style: "text-align:right", text: price.seat_fees ? money2(price.seat_fees) : "Included" })]),
          el("tr", {}, [el("td", {}, el("strong", { text: "Total due today" })), el("td", { style: "text-align:right" }, el("strong", { text: money2(price.total) }))])
        ]))
      ]),
      el("section", { class: "card", "aria-labelledby": "rv-pay" }, [
        el("h2", { id: "rv-pay", text: "Payment" }),
        el("div", { class: "card-on-file" }, [el("span", { class: "visa", text: "VISA" }), el("div", {}, [el("strong", { text: "Visa ending in 4417" }), el("div", { class: "hint", text: "Jordan Lee · expires 09/28 · saved to your Alder Rewards account" })])]),
        el("details", { class: "rules", style: "margin-top:16px" }, [el("summary", { text: `${state.fare.name} fare rules` }), el("ul", {}, FARE_FEATURES[state.fare.code].list.concat(["Name changes aren't permitted", "24-hour risk-free cancellation if booked 7+ days before departure"]).map((t) => el("li", { text: t })))]),
        el("div", { class: "field", style: "margin-top:14px" }, [el("label", { class: "check" }, [rules, "I've read and accept the fare rules, the contract of carriage and the hazardous materials policy."]), fieldError("fare-rules", errFor("fare-rules"))])
      ]),
      el("div", { class: "actions" }, [el("a", { href: "#/travelers", text: "‹ Back to travelers" }), confirmBtn])
    );
    confirmBtn.addEventListener("click", async () => {
      if (!state.fareRules) { renderReview.errors = [{ target: "fare-rules", message: "Review and accept the fare rules to continue." }]; return render(); }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Confirming…";
      const res = await api("/api/bookings", { method: "POST", body: JSON.stringify(bookingPayload()) });
      if (!res.ok) {
        renderReview.errors = (res.body.errors || [{ field: "main", message: "We couldn't complete your booking. Please try again." }]).map((e) => ({ target: fieldIdForServer(e.field), message: e.message }));
        return render();
      }
      state.booking = res.body;
      save();
      go("confirmation");
    });
  }

  function renderConfirmation() {
    const b = state.booking, f = state.flight;
    main.append(el("section", { class: "card confirm-hero", "aria-labelledby": "done-title" }, [
      el("h1", { id: "done-title", text: `You're going to ${cityOf(f.destination).split(/[,–]/)[0].trim()}!` }),
      el("p", { text: `Confirmation sent to ${state.contact.email}.` }),
      el("div", {}, [el("div", { class: "hint", text: "Confirmation code" }), el("div", { class: "pnr", text: b.code })]),
      el("p", { text: `${f.number.replace("AQ", "AQ ")} · ${longDate(f.date)} · ${timeText(f.depart)} ${f.origin} → ${timeText(f.arrive)} ${f.destination} · ${b.fare}` }),
      el("p", { text: state.passengers.map((p, i) => `${[p.first, p.last].join(" ")}${state.seats[i] ? " · seat " + state.seats[i] : ""}`).join("   |   ") }),
      el("p", {}, el("strong", { text: `Total charged: ${money2(b.price.total)}` })),
      el("button", { type: "button", class: "btn", text: "Book another trip", onclick: () => { state = blankState(); seatMapCache = null; save(); go("search"); } })
    ]));
    setTimeout(() => main.focus(), 0);
  }

  async function start() {
    main.append(loading("Loading…"));
    try {
      const res = await api("/api/airports");
      airports = res.body;
    } catch (e) {
      airports = [];
    }
    window.addEventListener("hashchange", render);
    render();
  }

  start();
})();
