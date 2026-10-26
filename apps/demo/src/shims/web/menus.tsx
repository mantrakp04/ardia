import { useEffect, useState, useSyncExternalStore } from "react";
import type { MenuItem } from "@ardia-real/shell";
import { useBrowser } from "../../../../browser/src/state/browser/store";
import { Symbol } from "./Symbol";

type OpenMenu = { items: MenuItem[]; x: number; y: number; resolve: (id: string | null) => void };

let open: OpenMenu | null = null;
const watchers = new Set<() => void>();
const publish = (next: OpenMenu | null) => {
  open = next;
  for (const watcher of watchers) watcher();
};

const pointer = { x: 0, y: 0 };
let commandHeld = false;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      commandHeld = e.metaKey;
    },
    true,
  );
  for (const type of ["keydown", "keyup"] as const) window.addEventListener(type, (e) => (commandHeld = e.metaKey), true);
}

export function showMenu(items: MenuItem[]): Promise<string | null> {
  open?.resolve(null);
  return new Promise((resolve) => publish({ items, x: pointer.x, y: pointer.y, resolve }));
}

const close = (id: string | null) => {
  const menu = open;
  publish(null);
  menu?.resolve(id);
};

const KEYS: Record<string, string> = { command: "⌘", shift: "⇧", option: "⌥", control: "⌃" };

function MenuList({ items, x, y }: { items: MenuItem[]; x: number; y: number }) {
  const [sub, setSub] = useState<{ index: number; top: number } | null>(null);
  const [command, setCommand] = useState(commandHeld);
  const dark = useBrowser((s) => s.ui.appDark);
  useEffect(() => {
    const track = (e: KeyboardEvent | PointerEvent) => setCommand(e.metaKey);
    const events = ["keydown", "keyup", "pointermove"] as const;
    for (const type of events) document.addEventListener(type, track);
    return () => {
      for (const type of events) document.removeEventListener(type, track);
    };
  }, []);
  const width = 240;
  const left = Math.min(x, window.innerWidth - width - 8);
  return (
    <div className={`ardia-menu${dark ? " dark" : ""}`} style={{ left, top: Math.min(y, window.innerHeight - 40), width }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        if ("separator" in item) return <div key={i} className="ardia-menu-separator" />;
        const next = items[i + 1];
        if (item.alternate ? !command : command && next && "id" in next && next.alternate) return null;
        const enabled = item.enabled !== false;
        return (
          <div
            key={item.id + i}
            className={`ardia-menu-item${enabled ? "" : " disabled"}`}
            onPointerEnter={(e) => setSub(item.children ? { index: i, top: (e.currentTarget as HTMLElement).getBoundingClientRect().top } : null)}
            onClick={() => enabled && !item.children && close(item.id)}
          >
            <span className="ardia-menu-check">{item.checked ? "✓" : ""}</span>
            {item.symbol ? <Symbol name={item.symbol} size={12} color="currentColor" style={{ width: 16, height: 16, marginRight: 6 }} /> : null}
            {item.swatch ? <span className="ardia-menu-swatch" style={{ background: item.swatch }} /> : null}
            <span className="ardia-menu-title">{item.title}</span>
            <span className="ardia-menu-key">{item.children ? "›" : item.key ? `${(item.modifiers ?? []).map((m) => KEYS[m]).join("")}${item.key.toUpperCase()}` : ""}</span>
            {sub?.index === i && item.children ? <MenuList items={item.children} x={left + width - 4} y={sub.top - 5} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function MenuHost() {
  const menu = useSyncExternalStore(
    (watch) => (watchers.add(watch), () => void watchers.delete(watch)),
    () => open,
  );
  useEffect(() => {
    if (!menu) return;
    const outside = () => close(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  return menu ? <MenuList items={menu.items} x={menu.x} y={menu.y} /> : null;
}
