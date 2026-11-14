import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { notePageAsked, notePageSettled, watchDialogsWith, windowsDialogPages } from "../../../../packages/expo-windows/src/engine/dialogPages.ts";
import { takeDialogPageCounts } from "../state/telemetry/dialogPageCounts.ts";

test("a page asked while a dialog is open counts, and stalls only if it hasn't loaded 10 s later", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let open = false;
    watchDialogsWith(() => open);
    windowsDialogPages.takeDialogPages();
    notePageAsked("no-dialog");
    open = true;
    notePageAsked("loads");
    notePageAsked("stalls");
    notePageAsked("closed");
    mock.timers.tick(4000);
    notePageSettled("loads");
    notePageSettled("closed");
    mock.timers.tick(6001);
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 3, stalled: 1 });
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 0, stalled: 0 });
    watchDialogsWith(() => {
      throw new Error("no native module");
    });
    notePageAsked("throws");
    assert.deepEqual(windowsDialogPages.takeDialogPages(), { asked: 0, stalled: 0 });
  } finally {
    mock.timers.reset();
  }
});

test("the hourly extras name the counts, and the Mac sends zeros", () => {
  assert.deepEqual(takeDialogPageCounts(), { dialog_pages_asked: 0, dialog_pages_stalled: 0 });
});

test("every native modal runs through RunModal off the UI thread, and the app stops them before the UI queue goes", () => {
  const native = (name) => readFileSync(new URL(`../../windows/Ardia/${name}`, import.meta.url), "utf8");
  const module = native("DialogsModule.h");
  for (const shown of ["ShowConfirm(owner, title", "ShowPrompt(owner,", "ShowOpenFiles(owner)", "ShowSaveFile(owner,", "ShowOpenFolder(owner,"]) {
    const at = module.indexOf(shown);
    assert.ok(at > 0, shown);
    assert.ok(module.lastIndexOf("DialogParts::RunModal(owner,", at) > module.lastIndexOf("REACT_METHOD(", at), `${shown} isn't inside RunModal`);
  }
  for (const [file, count] of [["NativeDialogs.h", 4], ["SaveDialog.h", 1]]) {
    assert.equal(native(file).split("ModalOverWindow modal(owner,").length - 1, count, file);
    assert.equal(native(file).split("ModalWatch::OnAbandon(").length - 1, count, file);
  }
  assert.match(module, /  ModalWatch watch;\n  OpenDialogScope open;\n  HeldPageWindows pages;\n  ModalParent parent;\n\};/);
  for (const file of ["NativeDialogs.h", "SaveDialog.h"]) {
    const source = native(file);
    for (const call of [/hwndParent = (\w+)/g, /MessageBoxW\((\w+)/g, /builder\.words\.data\(\)\), (\w+(?:\.Parent\(\))?)/g, /->Show\(([\w.()]+)\)/g]) {
      for (const [, parent] of source.matchAll(call)) assert.ok(parent.startsWith("modal"), `${file} gives ${parent} to a dialog: a window on another thread must never own it`);
    }
  }
  assert.match(module, /ModalWatch::OnTick\(\[this\] \{\n      pages\.Refresh\(\);\n      parent\.KeepDialogAboveOwner\(\);\n    \}\);/);
  assert.match(native("ModalThread.h"), /SetThreadDpiAwarenessContext\(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2\);/);
  const windows = native("WindowManager.h");
  assert.match(windows, /if \(message == WM_ACTIVATE && LOWORD\(wParam\) != WA_INACTIVE && DialogParts::BringModalForward\(hwnd\)\) return 0;/);
  assert.match(windows, /if \(!DialogParts::BringModalForward\(entry->hwnd\)\) SetForegroundWindow\(entry->hwnd\);/);
  assert.match(native("NativeDialogs.h"), /else if \(HWND fallback = modal\.parent\.Dialog\(\)\) PostMessageW\(fallback, WM_COMMAND, IDCANCEL, 0\);/);
  assert.match(native("Ardia.cpp"), /void ArdiaAppStop\(void\) \{\n  Ardia::DialogParts::StopAllModals\(\);/);
  assert.match(native("Ardia.cpp"), /host\.engine = nullptr;\n  SetFocus\(nullptr\);\n  if \(host\.queue\) host\.queue\.ShutdownQueue\(\);/);
  assert.match(module, /parent\(owner, !Background\(\)\)/);
  const thread = native("ModalThread.h");
  assert.match(thread, /!m_ownerWasEnabled \|\| Stopping\(\)\) return;\n    bool hadFocus = m_givesFocusBack && DialogInFront\(\);/);
  assert.doesNotMatch(thread, /OursInFront/);
  assert.match(module, /void Release\(\) noexcept \{\n    if \(Stopping\(\)\) \{\n      m_pages\.clear\(\);\n      return;\n    \}/);
});
