(() => {
  for (const button of document.querySelectorAll(".copy")) {
    button.addEventListener("click", async () => {
      const code = button.closest(".code-block").querySelector("code").textContent;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Press ⌘C";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 1500);
    });
  }
  const search = document.querySelector(".search input");
  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (event.key === "/" && !typing && search) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });
  const menu = document.querySelector(".version-menu");
  document.addEventListener("click", (event) => {
    if (menu && menu.open && !menu.contains(event.target)) menu.open = false;
  });
  const active = document.querySelector(".sidebar a.active");
  const sidebar = document.querySelector(".sidebar");
  if (active && sidebar) sidebar.scrollTop = Math.max(0, active.offsetTop - sidebar.clientHeight / 2);
})();
