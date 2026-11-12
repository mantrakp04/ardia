import { request } from "../../realism.js";

const $ = (id) => document.getElementById(id);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_NAMES = { processing: "Processing", shipped: "Shipped", delivered: "Delivered", archived: "Archived" };
const CHANNEL_NAMES = { online_store: "Online store", legacy_store: "Legacy store", pos: "Point of Sale", wholesale: "Wholesale" };
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,39}$/;

const view = { page: 1, q: "", status: "", channel: "", pages: 1, loading: 0 };
const editing = { order: null, tags: [], status: "" };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null;
}

function dateText(iso) {
  const p = parts(iso);
  return p ? `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}` : "—";
}

function dateTimeText(iso) {
  const p = parts(iso);
  if (!p) return "—";
  const h12 = p.h % 12 || 12;
  return `${MONTHS[p.mo - 1]} ${p.d}, ${p.y} at ${h12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "AM" : "PM"}`;
}

const money = (amount) => "$" + Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const badge = (status) => el("span", { class: `badge ${status}` }, STATUS_NAMES[status] || status);

function readUrl() {
  const params = new URLSearchParams(location.search);
  view.page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  view.q = params.get("q") || "";
  view.status = params.get("status") || "";
  view.channel = params.get("channel") || "";
  $("q").value = view.q;
  $("f-status").value = view.status;
  $("f-channel").value = view.channel;
}

function writeUrl() {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.status) params.set("status", view.status);
  if (view.channel) params.set("channel", view.channel);
  if (view.page > 1) params.set("page", String(view.page));
  const qs = params.toString();
  history.replaceState(null, "", qs ? `/?${qs}` : "/");
}

async function load() {
  const ticket = ++view.loading;
  const params = new URLSearchParams({ page: String(view.page), q: view.q, status: view.status, channel: view.channel });
  const res = await request(`/api/orders?${params}`);
  const data = await res.json();
  if (ticket !== view.loading) return;
  view.page = data.page;
  view.pages = data.pages;
  writeUrl();
  render(data);
}

function render(data) {
  const rows = $("rows");
  rows.replaceChildren();
  if (!data.orders.length) {
    rows.append(el("tr", {}, el("td", { colspan: "8", class: "empty" }, "No orders match these filters.")));
  }
  for (const o of data.orders) {
    const tr = el("tr", { "data-id": String(o.id), onclick: () => openOrder(o.id) },
      el("td", {}, el("button", { type: "button", class: "link-btn", "aria-label": `Open order ${o.name}` }, o.name)),
      el("td", {}, dateText(o.created_at)),
      el("td", { class: "cust" }, o.customer.name),
      el("td", {}, el("span", { class: `chan ${o.channel}` }, CHANNEL_NAMES[o.channel])),
      el("td", { class: "right" }, money(o.total)),
      el("td", {}, badge(o.status)),
      el("td", {}, o.delivered_at ? dateText(o.delivered_at) : el("span", { class: "muted" }, "—")),
      el("td", { class: "tags-cell" }, o.tags.length ? o.tags.map((t) => el("span", { class: "chip" }, t)) : el("span", { class: "muted" }, "")));
    rows.append(tr);
  }
  const first = data.total ? (data.page - 1) * data.per_page + 1 : 0;
  const last = Math.min(data.total, data.page * data.per_page);
  $("range").textContent = data.total ? `Showing ${first}–${last} of ${data.total} orders` : "No orders";
  $("pageinfo").textContent = `Page ${data.page} of ${data.pages}`;
  $("prev").disabled = data.page <= 1;
  $("next").disabled = data.page >= data.pages;
  if (!view.q && !view.status && !view.channel) $("nav-count").textContent = String(data.total);
}

function renderTags() {
  const box = $("o-tags");
  const input = $("o-tag-input");
  for (const chip of [...box.querySelectorAll(".chip")]) chip.remove();
  for (const tag of editing.tags) {
    const chip = el("span", { class: "chip" }, tag,
      el("button", { type: "button", "aria-label": `Remove tag ${tag}`, onclick: (e) => { e.stopPropagation(); removeTag(tag); } }, "×"));
    box.insertBefore(chip, input);
  }
  refreshDirty();
}

function addTag(raw) {
  const tag = raw.replace(/\s+/g, " ").trim();
  if (!tag) return true;
  if (!TAG_PATTERN.test(tag)) {
    $("o-error").textContent = "Tags can use letters, numbers, spaces, '-', '_' and '.' (up to 40 characters).";
    return false;
  }
  if (!editing.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) editing.tags.push(tag);
  $("o-error").textContent = "";
  renderTags();
  return true;
}

function removeTag(tag) {
  editing.tags = editing.tags.filter((t) => t !== tag);
  renderTags();
  $("o-tag-input").focus();
}

function isDirty() {
  const o = editing.order;
  if (!o) return false;
  const pending = $("o-tag-input").value.trim();
  return Boolean(pending) || editing.status !== o.status || editing.tags.join("\n") !== o.tags.join("\n");
}

function refreshDirty() {
  $("o-save").disabled = !isDirty();
}

function timeline(o) {
  const list = $("o-timeline");
  list.replaceChildren();
  const steps = [["Placed", o.created_at], ["Shipped", o.shipped_at], ["Delivered", o.delivered_at], ["Archived", o.archived_at]];
  for (const [label, at] of steps) {
    if (!at) continue;
    list.append(el("li", {}, el("span", {}, label), el("span", { class: "muted" }, dateTimeText(at))));
  }
}

async function openOrder(id) {
  const res = await request(`/api/orders/${id}`);
  if (!res.ok) return;
  const o = await res.json();
  editing.order = o;
  editing.tags = [...o.tags];
  editing.status = o.status;
  $("o-name").textContent = `Order ${o.name}`;
  $("o-meta").textContent = `${dateTimeText(o.created_at)} · ${CHANNEL_NAMES[o.channel]}`;
  $("o-badge").replaceChildren(badge(o.status));
  $("o-items").replaceChildren(...o.line_items.map((li) =>
    el("tr", {}, el("td", {}, li.title), el("td", { class: "qty" }, `× ${li.quantity}`), el("td", { class: "amt" }, money(Number(li.price) * li.quantity)))));
  $("o-total").textContent = money(o.total);
  timeline(o);
  $("o-note").textContent = o.note || "No notes from the customer.";
  $("o-customer").textContent = o.customer.name;
  $("o-email").textContent = o.customer.email || "No email on file";
  $("o-status").value = o.status;
  $("o-tag-input").value = "";
  $("o-error").textContent = "";
  renderTags();
  const dialog = $("order");
  if (!dialog.open) dialog.showModal();
  $("o-tag-input").focus();
}

function closeOrder() {
  $("order").close();
  editing.order = null;
}

async function save() {
  const o = editing.order;
  if (!o) return;
  const input = $("o-tag-input");
  if (input.value.trim()) {
    if (!addTag(input.value)) return;
    input.value = "";
  }
  if (!isDirty()) return closeOrder();
  $("o-save").disabled = true;
  $("o-error").textContent = "";
  const res = await request(`/api/orders/${o.id}`, { method: "PATCH", body: { tags: editing.tags, status: editing.status } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    $("o-error").textContent = data.error || "Couldn't save this order. Try again.";
    refreshDirty();
    return;
  }
  closeOrder();
  toast(`Order ${data.name} saved`);
  load();
}

let toastTimer = 0;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

function wire() {
  let searchTimer = 0;
  $("q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { view.q = $("q").value.trim(); view.page = 1; load(); }, 250);
  });
  $("f-status").addEventListener("change", () => { view.status = $("f-status").value; view.page = 1; load(); });
  $("f-channel").addEventListener("change", () => { view.channel = $("f-channel").value; view.page = 1; load(); });
  $("prev").addEventListener("click", () => { if (view.page > 1) { view.page -= 1; load(); } });
  $("next").addEventListener("click", () => { if (view.page < view.pages) { view.page += 1; load(); } });
  $("refresh").addEventListener("click", load);
  const input = $("o-tag-input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (addTag(input.value)) input.value = "";
      refreshDirty();
    } else if (e.key === "Backspace" && !input.value && editing.tags.length) {
      editing.tags.pop();
      renderTags();
    }
  });
  input.addEventListener("input", () => {
    if (input.value.includes(",")) {
      const pieces = input.value.split(",");
      input.value = pieces.pop();
      for (const piece of pieces) addTag(piece);
    }
    refreshDirty();
  });
  $("o-tags").addEventListener("click", () => input.focus());
  $("o-status").addEventListener("change", () => { editing.status = $("o-status").value; refreshDirty(); });
  $("o-form").addEventListener("submit", (e) => { e.preventDefault(); save(); });
  $("o-cancel").addEventListener("click", closeOrder);
  $("o-close").addEventListener("click", closeOrder);
  $("order").addEventListener("close", () => { editing.order = null; });
}

readUrl();
wire();
load();
