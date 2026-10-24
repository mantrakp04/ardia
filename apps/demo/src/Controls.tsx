import type { BrowserCommand } from "@ardia-real/shell";
import { emitCommand } from "@ardia/shell";
import { useMemo } from "react";
import { noteScroll } from "../../browser/src/components/layout/toolbarAutoHide";
import { useBrowser, type BrowserState } from "../../browser/src/store/browser";
import { splitOf } from "../../browser/src/store/splits";
import { isFrameable } from "./frameable";
import { Symbol } from "./shims/web/Symbol";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const CMD = isMac ? "⌘" : "Ctrl+";
const CTRL = isMac ? "⌃" : "Alt+";

const run = (command: BrowserCommand, arg: string | null = null) => emitCommand({ command, arg, windowId: useBrowser.getState().ui.focusedWindowId });

function focusedWindow(s: BrowserState) {
  return s.windows[s.ui.focusedWindowId ?? ""];
}

function activeTab(s: BrowserState) {
  const w = focusedWindow(s);
  return w ? w.activeTabIds[w.profileId] : undefined;
}

function toggleSplit() {
  const s = useBrowser.getState();
  const w = focusedWindow(s);
  const active = activeTab(s);
  if (!w || !active) return;
  const split = splitOf(s, active);
  if (split) return s.separateSplit(split.id);
  const partner = w.tabIds.map((id) => s.tabs[id]).find((t) => t && t.id !== active && t.profileId === w.profileId && !t.pinned && t.url && isFrameable(t.url));
  if (partner) s.createSplit([active, partner.id]);
  else run("openSplitPane");
}

type TabsMode = "sidebar" | "autoHide" | "top";
type AddressMode = "toolbar" | "autoHide" | "sidebar";

function setTabs(mode: TabsMode) {
  const s = useBrowser.getState();
  const w = focusedWindow(s);
  if (!w) return;
  const onTop = (w.tabLayout ?? s.settings.tabLayout) === "top";
  if (onTop !== (mode === "top")) s.toggleTabLayout(w.id);
  if (mode !== "top" && w.sidebarOpen !== (mode === "sidebar")) s.toggleSidebar(w.id);
}

function shownTabs(s: BrowserState) {
  const active = activeTab(s);
  if (!active) return [];
  return splitOf(s, active)?.tabIds ?? [active];
}

function setAddress(mode: AddressMode) {
  const s = useBrowser.getState();
  s.updateSettings({ addressBar: mode === "sidebar" ? "sidebar" : "toolbar", hideToolbarWhileScrolling: mode === "autoHide" });
  if (mode === "autoHide") for (const id of shownTabs(s)) noteScroll(id, { state: "down" });
}

type Option = { value: string; label: string; hint?: string; disabled?: boolean };
export type Control =
  | { kind: "choice"; id: "tabs" | "side" | "address" | "newTabOpens" | "profile" | "theme"; label: string; value: string; options: Option[] }
  | { kind: "action"; id: "newTab" | "split" | "command"; label: string; icon: string; hint: string; on?: boolean };

export function controlModel(s: BrowserState): Control[] {
  const w = focusedWindow(s);
  const active = activeTab(s);
  const onTop = (w?.tabLayout ?? s.settings.tabLayout) === "top";
  const tabs: TabsMode = onTop ? "top" : w?.sidebarOpen ? "sidebar" : "autoHide";
  const address: AddressMode = s.settings.addressBar === "sidebar" && !onTop ? "sidebar" : s.settings.hideToolbarWhileScrolling ? "autoHide" : "toolbar";
  const profiles = s.profileOrder.map((id) => s.profiles[id]).filter((p) => !!p);
  return [
    {
      kind: "choice",
      id: "tabs",
      label: "Tabs",
      value: tabs,
      options: [
        { value: "sidebar", label: "Sidebar" },
        { value: "autoHide", label: "Auto-hide", hint: `${CMD}S` },
        { value: "top", label: "Top", hint: `⇧${CMD}S` },
      ],
    },
    {
      kind: "choice",
      id: "side",
      label: "Side",
      value: s.settings.sidebarSide,
      options: [
        { value: "left", label: "Left", disabled: onTop },
        { value: "right", label: "Right", disabled: onTop },
      ],
    },
    {
      kind: "choice",
      id: "address",
      label: "Address bar",
      value: address,
      options: [
        { value: "toolbar", label: "Toolbar" },
        { value: "autoHide", label: "Auto-hide" },
        { value: "sidebar", label: "Sidebar", disabled: onTop },
      ],
    },
    {
      kind: "choice",
      id: "newTabOpens",
      label: "New tabs",
      value: s.settings.newTabOpens,
      options: [
        { value: "page", label: "Page" },
        { value: "commandBar", label: "Command bar" },
      ],
    },
    { kind: "action", id: "newTab", label: "New tab", icon: "plus", hint: `${CMD}T` },
    { kind: "action", id: "split", label: "Split view", icon: "rectangle.split.2x1", hint: `${CTRL}⇧=`, on: !!(active && splitOf(s, active)) },
    { kind: "action", id: "command", label: "Command bar", icon: "magnifyingglass", hint: `${CMD}L` },
    { kind: "choice", id: "profile", label: "Profile", value: w?.profileId ?? "", options: profiles.map((p, i) => ({ value: p.id, label: p.name, hint: `${CTRL}${i + 1}` })) },
    {
      kind: "choice",
      id: "theme",
      label: "Theme",
      value: s.ui.appDark ? "dark" : "light",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    },
  ];
}

export function applyControl(id: Control["id"], value?: string) {
  if (id === "tabs") return setTabs(value as TabsMode);
  if (id === "address") return setAddress(value as AddressMode);
  if (id === "side" && (value === "left" || value === "right")) return useBrowser.getState().updateSettings({ sidebarSide: value });
  if (id === "newTabOpens" && (value === "page" || value === "commandBar")) return useBrowser.getState().updateSettings({ newTabOpens: value });
  if (id === "newTab") return run("newTab");
  if (id === "profile" && value) return run("switchProfile", value);
  if (id === "theme" && value) return run("setAppearance", value);
  if (id === "split") return toggleSplit();
  if (id === "command") return run("focusCommandBar");
}

const title = (label: string, hint?: string) => (hint ? `${label} (${hint})` : label);

function ChoiceGroup({ control }: { control: Extract<Control, { kind: "choice" }> }) {
  return (
    <div className="ardia-control-group" role="radiogroup" aria-label={control.label}>
      <span className="ardia-control-label">{control.label}</span>
      {control.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          className="ardia-control"
          aria-checked={control.value === o.value}
          disabled={o.disabled}
          title={title(`${control.label}: ${o.label}`, o.hint)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyControl(control.id, o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ActionButton({ control }: { control: Extract<Control, { kind: "action" }> }) {
  return (
    <button
      type="button"
      className="ardia-control"
      aria-pressed={control.on}
      title={title(control.label, control.hint)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => applyControl(control.id)}
    >
      <Symbol name={control.icon} size={13} weight="medium" style={{ width: 15, height: 15 }} />
      <span>{control.label}</span>
    </button>
  );
}

export function Controls() {
  const snapshot = useBrowser((s) => JSON.stringify(controlModel(s)));
  const controls = useMemo(() => JSON.parse(snapshot) as Control[], [snapshot]);
  const actions = controls.filter((c) => c.kind === "action");
  const firstAction = actions[0]?.id;
  return (
    <div className="ardia-controls" role="toolbar" aria-label="Try Ardia">
      {controls.map((c) =>
        c.kind === "choice" ? (
          <ChoiceGroup key={c.id} control={c} />
        ) : c.id === firstAction ? (
          <div key={c.id} className="ardia-control-group">
            {actions.map((a) => (
              <ActionButton key={a.id} control={a} />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
