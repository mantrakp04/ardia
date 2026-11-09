(() => {
  const OPTIONS = ["Travel", "Meals", "Software", "Office", "Other"];
  const template = document.createElement("template");
  template.innerHTML = `
<style>
:host{display:block;position:relative;font:inherit}
.trigger{width:100%;height:38px;display:flex;justify-content:space-between;align-items:center;border:1px solid #cfcfca;border-radius:8px;background:#fff;padding:0 10px;font:inherit;cursor:pointer;color:#1d1d1b}
.trigger:focus-visible{outline:2px solid #2f6b4f;outline-offset:-1px}
.trigger .placeholder{color:#6b6b66}
.pop{position:absolute;top:42px;left:0;right:0;z-index:6;background:#fff;border:1px solid #e4e4e0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px}
.pop[hidden]{display:none}
.filter{width:100%;height:34px;border:1px solid #cfcfca;border-radius:7px;padding:0 8px;font:inherit;margin-bottom:4px}
.filter:focus{outline:2px solid #2f6b4f;outline-offset:-1px}
ul{list-style:none;margin:0;padding:0;max-height:220px;overflow:auto}
li{padding:7px 10px;border-radius:6px;cursor:pointer}
li[aria-selected=true]::after{content:"✓";float:right;color:#2f6b4f}
li.active{background:#eef5f0}
li[hidden]{display:none}
.none{padding:7px 10px;color:#6b6b66}
</style>
<button class="trigger" type="button" part="trigger" aria-haspopup="listbox" aria-expanded="false"><span class="text"></span><span aria-hidden="true">▾</span></button>
<div class="pop" hidden>
  <input class="filter" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" autocomplete="off" spellcheck="false" placeholder="Type to filter">
  <ul role="listbox"></ul>
  <div class="none" hidden>No matches</div>
</div>`;

  let uid = 0;

  class CategoryPicker extends HTMLElement {
    constructor() {
      super();
      this._value = "";
      this._active = -1;
      this._id = `cp${++uid}`;
      const root = this.attachShadow({ mode: "open" });
      root.append(template.content.cloneNode(true));
      this._trigger = root.querySelector(".trigger");
      this._text = root.querySelector(".text");
      this._pop = root.querySelector(".pop");
      this._filter = root.querySelector(".filter");
      this._list = root.querySelector("ul");
      this._none = root.querySelector(".none");
      this._list.id = `${this._id}-list`;
      this._filter.setAttribute("aria-controls", this._list.id);
      this._options = OPTIONS.map((name, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = `${this._id}-opt-${i}`;
        li.dataset.value = name;
        li.textContent = name;
        li.setAttribute("aria-selected", "false");
        li.addEventListener("mousedown", (e) => e.preventDefault());
        li.addEventListener("click", () => this._pick(name));
        li.addEventListener("mousemove", () => this._setActive(this._visible().indexOf(li)));
        this._list.append(li);
        return li;
      });
      this._trigger.addEventListener("click", () => (this._pop.hidden ? this.open() : this.close(true)));
      this._trigger.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.open();
        } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          this.open();
          this._filter.value = e.key;
          this._applyFilter();
        }
      });
      this._filter.addEventListener("input", () => this._applyFilter());
      this._filter.addEventListener("keydown", (e) => this._onFilterKey(e));
      this._outside = (e) => {
        if (!e.composedPath().includes(this)) this.close(false);
      };
    }

    static get observedAttributes() {
      return ["label", "disabled"];
    }

    attributeChangedCallback() {
      this._render();
    }

    connectedCallback() {
      this._render();
    }

    get value() {
      return this._value;
    }

    set value(v) {
      this._value = OPTIONS.includes(v) ? v : "";
      this._render();
    }

    focus() {
      this._trigger.focus();
    }

    _render() {
      const label = this.getAttribute("label") || "Category";
      this._text.textContent = this._value || "Select a category";
      this._text.className = this._value ? "text" : "text placeholder";
      this._trigger.setAttribute("aria-label", `${label}: ${this._value || "none selected"}`);
      this._trigger.disabled = this.hasAttribute("disabled");
      this._list.setAttribute("aria-label", label);
      this._filter.setAttribute("aria-label", `Filter ${label.toLowerCase()} options`);
      for (const li of this._options) li.setAttribute("aria-selected", li.dataset.value === this._value ? "true" : "false");
    }

    _visible() {
      return this._options.filter((li) => !li.hidden);
    }

    _setActive(i) {
      const vis = this._visible();
      this._active = vis.length ? Math.max(0, Math.min(vis.length - 1, i)) : -1;
      for (const li of this._options) li.classList.remove("active");
      const cur = vis[this._active];
      if (cur) {
        cur.classList.add("active");
        this._filter.setAttribute("aria-activedescendant", cur.id);
        cur.scrollIntoView({ block: "nearest" });
      } else {
        this._filter.removeAttribute("aria-activedescendant");
      }
    }

    _applyFilter() {
      const q = this._filter.value.trim().toLowerCase();
      for (const li of this._options) li.hidden = !!q && !li.dataset.value.toLowerCase().includes(q);
      const vis = this._visible();
      this._none.hidden = vis.length > 0;
      const starts = vis.findIndex((li) => li.dataset.value.toLowerCase().startsWith(q));
      this._setActive(starts >= 0 ? starts : 0);
    }

    _onFilterKey(e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this._setActive(this._active + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cur = this._visible()[this._active];
        if (cur) this._pick(cur.dataset.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      } else if (e.key === "Tab") {
        this.close(false);
      }
    }

    open() {
      if (!this._pop.hidden || this._trigger.disabled) return;
      this._pop.hidden = false;
      this._trigger.setAttribute("aria-expanded", "true");
      this._filter.value = "";
      this._applyFilter();
      const sel = this._visible().findIndex((li) => li.dataset.value === this._value);
      this._setActive(sel >= 0 ? sel : 0);
      this._filter.focus();
      document.addEventListener("mousedown", this._outside, true);
    }

    close(refocus) {
      if (this._pop.hidden) return;
      this._pop.hidden = true;
      this._trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", this._outside, true);
      if (refocus) this._trigger.focus();
    }

    _pick(name) {
      const changed = name !== this._value;
      this._value = name;
      this._render();
      this.close(true);
      if (changed) this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
  }

  customElements.define("category-picker", CategoryPicker);
})();
