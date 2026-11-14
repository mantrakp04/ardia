import { request } from "../../realism.js";

const $ = (id) => document.getElementById(id);
const MASK = "sfa_live_" + "•".repeat(32);
let token = "";
let shown = false;

function showSection(name) {
  const section = name === "developer" ? "developer" : "general";
  for (const node of document.querySelectorAll(".section")) node.classList.toggle("active", node.id === section);
  for (const link of document.querySelectorAll(".settings-nav a")) {
    if (link.dataset.section === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function sectionFromPath() {
  return location.pathname.split("/")[2] || "general";
}

async function toggleToken() {
  const field = $("token");
  if (shown) {
    shown = false;
    field.value = MASK;
    $("reveal").textContent = "Reveal";
    $("copy").hidden = true;
    return;
  }
  if (!token) {
    const res = await request("/api/developer/token");
    if (!res.ok) {
      toast("Couldn't load the token. Reload the page and try again.");
      return;
    }
    token = (await res.json()).token;
  }
  shown = true;
  field.value = token;
  $("reveal").textContent = "Hide";
  $("copy").hidden = false;
  field.select();
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(token);
    toast("Token copied");
  } catch {
    $("token").select();
    toast("Press ⌘C to copy the selected token");
  }
}

let toastTimer = 0;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2600);
}

for (const link of document.querySelectorAll(".settings-nav a")) {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    history.pushState(null, "", link.getAttribute("href"));
    showSection(link.dataset.section);
  });
}
window.addEventListener("popstate", () => showSection(sectionFromPath()));
$("reveal").addEventListener("click", toggleToken);
$("copy").addEventListener("click", copyToken);
showSection(sectionFromPath());
