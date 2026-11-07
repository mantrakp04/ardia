import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { MenuItem } from "@ardia-real/shell";
import { useBrowser } from "../../browser/src/state/browser/store";
import { Symbol } from "./shims/web/Symbol";
import { formatShortcut } from "./shortcutFormat";
import { heldModifiers, type MenuModifier } from "./clickModifiers";
import { useInputRegion } from "./shellAbove";
import { useGlassPanel } from "./shellGlass";
import { watchPageFocus } from "./pageFocus";

type OpenMenu = { items: MenuItem[]; x: number; y: number; resolve: (id: string | null) => void };

export function alternateShown(primary: MenuItem | undefined, alternate: MenuItem, held: ReadonlySet<MenuModifier>): boolean {
  const base = new Set(primary && "id" in primary ? primary.modifiers ?? [] : []);
  const own = "id" in alternate ? alternate.modifiers ?? [] : [];
  const extra = own.filter((modifier) => !base.has(modifier));
  return (extra.length ? extra : ["command" as const]).every((modifier) => held.has(modifier));
}

let open: OpenMenu | null = null;
export const menuShown = () => open !== null;
const watchers = new Set<() => void>();
export const watchMenus = (watcher: () => void) => {
  watchers.add(watcher);
  return () => void watchers.delete(watcher);
};
let stopPageFocus: (() => void) | null = null;
const publish = (next: OpenMenu | null) => {
  open = next;
  if (next) stopPageFocus ??= watchPageFocus(() => close(null));
  else {
    stopPageFocus?.();
    stopPageFocus = null;
  }
  for (const watcher of watchers) watcher();
};

const pointer = { x: 0, y: 0 };
let held: ReadonlySet<MenuModifier> = new Set();
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      held = heldModifiers(e);
    },
    true,
  );
  for (const type of ["keydown", "keyup"] as const) window.addEventListener(type, (e) => (held = heldModifiers(e)), true);
}

export function showMenu(items: MenuItem[], at: { x: number; y: number } = pointer): Promise<string | null> {
  open?.resolve(null);
  return new Promise((resolve) => publish({ items, x: at.x, y: at.y, resolve }));
}

const close = (id: string | null) => {
  const menu = open;
  publish(null);
  menu?.resolve(id);
};

export function menuButtonPresses(show: () => void) {
  let openAtPointerDown = false;
  return {
    pointerDown: () => void (openAtPointerDown = menuShown()),
    click: () => {
      const wasOpen = openAtPointerDown || menuShown();
      openAtPointerDown = false;
      if (!wasOpen) show();
      else if (open) close(null);
    },
  };
}

type MenuAnchor = { x: number; y: number } | { row: HTMLElement };

function MenuList({ items, anchor }: { items: MenuItem[]; anchor: MenuAnchor }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useGlassPanel(menuRef);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [sub, setSub] = useState<{ item: MenuItem; row: HTMLElement } | null>(null);
  const [modifiers, setModifiers] = useState(held);
  const dark = useBrowser((s) => s.ui.appDark);
  useLayoutEffect(() => {
    const place = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const { width, height } = menu.getBoundingClientRect();
      let left: number;
      let top: number;
      if ("row" in anchor) {
        const row = anchor.row.getBoundingClientRect();
        const parent = anchor.row.closest(".ardia-menu")!.getBoundingClientRect();
        left = parent.right - 4;
        top = row.top - 5;
        if (left + width > window.innerWidth - 8) left = parent.left - width + 4;
      } else {
        left = anchor.x;
        top = anchor.y;
      }
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
      setPosition((previous) => previous.left === left && previous.top === top ? previous : { left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, modifiers, items]);
  useInputRegion(menuRef);
  useEffect(() => {
    const track = (e: KeyboardEvent | PointerEvent) => {
      const next = heldModifiers(e);
      setModifiers((previous) => (previous.size === next.size && [...next].every((modifier) => previous.has(modifier)) ? previous : next));
    };
    const events = ["keydown", "keyup", "pointermove"] as const;
    for (const type of events) document.addEventListener(type, track);
    return () => {
      for (const type of events) document.removeEventListener(type, track);
    };
  }, []);
  return createPortal(
    <div ref={menuRef} className={`ardia-menu${dark ? " dark" : ""}`} style={{ ...position, width: 240, maxWidth: "calc(100vw - 26px)", maxHeight: "calc(100vh - 26px)", overflowY: "auto" }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        if ("separator" in item) return <div key={i} className="ardia-menu-separator" />;
        const next = items[i + 1];
        if (item.alternate ? !alternateShown(items[i - 1], item, modifiers) : next && "id" in next && next.alternate && alternateShown(item, next, modifiers)) return null;
        const enabled = item.enabled !== false;
        return (
          <div
            key={item.id + i}
            className={`ardia-menu-item${enabled ? "" : " disabled"}${sub?.item === item ? " expanded" : ""}`}
            onPointerEnter={(e) => setSub(enabled && item.children ? { item, row: e.currentTarget } : null)}
            onClick={() => enabled && !item.children && close(item.id)}
          >
            <span className="ardia-menu-check">{item.checked ? "✓" : ""}</span>
            {item.symbol ? <Symbol name={item.symbol} size={12} color="currentColor" style={{ width: 16, height: 16, marginRight: 6 }} /> : null}
            {item.swatch ? <span className="ardia-menu-swatch" style={{ background: item.swatch }} /> : null}
            <span className="ardia-menu-title">{item.title}</span>
            <span className="ardia-menu-key">{item.children ? "›" : item.key ? formatShortcut({ key: item.key, modifiers: item.modifiers ?? [] }) : ""}</span>
            {sub?.item === item && item.children ? <MenuList items={item.children} anchor={{ row: sub.row }} /> : null}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function MenuHost() {
  const menu = useSyncExternalStore(
    watchMenus,
    () => open,
  );
  useEffect(() => {
    if (!menu) return;
    const outside = () => close(null);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  return menu ? <MenuList items={menu.items} anchor={{ x: menu.x, y: menu.y }} /> : null;
}
