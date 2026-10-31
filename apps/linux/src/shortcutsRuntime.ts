import type { ShortcutModifier } from "@ardia-real/shell";
import { useBrowser } from "../../browser/src/state/browser/store";
import { emitNativeEvent, provideNativeModuleProvider } from "./shims/expo-modules-core";
import { ardiaHost, reportHostError, type ArdiaHost } from "./host";
import { keyboardCombo, linuxBindings, linuxNativeBindings, recordableShortcut, utilityBindings, type Binding } from "./shortcuts";

let capturing = false;
let holding = 0;
let holdingCode: number | null = null;
let pointerMoved = false;
let recording: { resolve: (combo: { key: string; modifiers: ShortcutModifier[] } | null) => void } | null = null;
const appEvent = (payload: unknown) => emitNativeEvent("ArdiaShell", "onAppEvent", payload);
const releaseSwitcher = () => {
  if (!holding && !holdingCode && !capturing) return;
  holding = 0;
  holdingCode = null;
  appEvent({ type: "switcherReleased" });
};

export async function cancelShortcutRecording() {
  const current = recording;
  recording = null;
  if (!current) return;
  try {
    await ardiaHost?.invoke("ArdiaShell.setShortcutRecording", { args: [false] });
  } finally {
    current.resolve(null);
  }
}

export async function recordShortcut(): Promise<{ key: string; modifiers: ShortcutModifier[] } | null> {
  await cancelShortcutRecording();
  return new Promise((resolve) => {
    recording = { resolve };
    void ardiaHost?.invoke("ArdiaShell.setShortcutRecording", { args: [true] }).catch((error) => {
      reportHostError(error);
      void cancelShortcutRecording();
    });
  });
}

export async function startLinuxShortcuts(host: ArdiaHost) {
  let bindings: Binding[] = [];
  let previous = "";
  let pending = Promise.resolve();
  const update = () => {
    const state = useBrowser.getState();
    bindings = linuxBindings(state.settings.shortcuts, state.profileOrder);
    if (host.bootstrap.utility) bindings = utilityBindings(bindings);
    const encoded = JSON.stringify(linuxNativeBindings(bindings, state.profileOrder));
    if (encoded === previous) return pending;
    previous = encoded;
    pending = pending.catch(reportHostError).then(async () => {
      await host.invoke("ArdiaShell.setKeyboardShortcuts", { args: [bindingsFor(encoded)] });
    });
    return pending;
  };
  const bindingsFor = (encoded: string) => JSON.parse(encoded) as Binding[];
  const hold = (binding: Binding) => {
    holding = [4, 16, 8].find((flag) => binding.modifiers & flag) ?? 0;
    holdingCode = holding ? null : binding.keyCode;
  };
  provideNativeModuleProvider((module, method) => {
    if (module !== "ArdiaShell") return undefined;
    if (method === "switcherPointerMoved") return () => pointerMoved;
    if (method === "setSwitcherCapture") return async (active: boolean) => {
      capturing = active;
      pointerMoved = false;
      await host.invoke("ArdiaShell.setSwitcherCapture", { args: [active] });
    };
    return undefined;
  });
  host.onEvent((module, event, payload) => {
    if (module !== "ArdiaShell" || event !== "onCommand") return;
    const command = payload as { command: string; arg: string | null; shortcutModifiers?: number };
    if (command.command !== "tabSwitcher") return;
    const binding = bindings.find((b) => b.command === command.command && b.arg === command.arg && b.modifiers === command.shortcutModifiers);
    if (binding) hold(binding);
    if (!capturing) void host.invoke("ArdiaShell.restoreShortcutFocus", { args: [] }).catch(reportHostError);
  });
  window.addEventListener("keydown", (event) => {
    const combo = keyboardCombo(event);
    if (recording) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") return void cancelShortcutRecording();
      if (!recordableShortcut(event)) return;
      const current = recording;
      recording = null;
      void host.invoke("ArdiaShell.setShortcutRecording", { args: [false] }).then(() => current.resolve({ key: combo.key, modifiers: combo.modifiers }), (error) => { reportHostError(error); current.resolve(null); });
      return;
    }
    const binding = bindings.find((b) => b.keyCode === combo.keyCode && b.modifiers === combo.flags);
    if (capturing && binding?.command !== "tabSwitcher") {
      const key = event.key === "Escape" ? "escape" : event.key === "ArrowRight" ? "next" : event.key === "ArrowLeft" ? "previous" : null;
      if (key) appEvent({ type: "switcherKey", key });
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!binding) return;
    if (binding.notInText && document.activeElement?.matches("input,textarea,[contenteditable]:not([contenteditable=false])")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (binding.command === "tabSwitcher") hold(binding);
    emitNativeEvent("ArdiaShell", "onCommand", { command: binding.command, arg: binding.arg, windowId: host.bootstrap.windowId });
  }, true);
  window.addEventListener("keyup", (event) => {
    const flag = event.key === "Control" ? 4 : event.key === "Meta" ? 16 : event.key === "Alt" ? 8 : event.key === "Shift" ? 2 : 0;
    if (flag && holding & flag || holdingCode && keyboardCombo(event).keyCode === holdingCode) releaseSwitcher();
  }, true);
  window.addEventListener("blur", () => { releaseSwitcher(); void cancelShortcutRecording(); });
  window.addEventListener("pointermove", () => { pointerMoved = true; }, true);
  window.addEventListener("pointerup", () => { if (capturing) appEvent({ type: "switcherMouseUp" }); }, true);
  useBrowser.subscribe(() => { void update().catch(reportHostError); });
  await update();
}
