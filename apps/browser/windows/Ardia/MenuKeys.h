#pragma once

#include <array>
#include <initializer_list>
#include <string>

#include "CommandTable.h"

namespace Ardia::Menus {

struct KeyPress {
  UINT virtualKey = 0;
  wchar_t fixed = 0;
  wchar_t base = 0;
  wchar_t shifted = 0;
  unsigned modifiers = 0;
  bool altGraph = false;
  bool windowsKey = false;
};

inline bool IsModifierKey(UINT virtualKey) noexcept {
  switch (virtualKey) {
    case VK_SHIFT:
    case VK_LSHIFT:
    case VK_RSHIFT:
    case VK_CONTROL:
    case VK_LCONTROL:
    case VK_RCONTROL:
    case VK_MENU:
    case VK_LMENU:
    case VK_RMENU:
    case VK_LWIN:
    case VK_RWIN:
    case VK_CAPITAL:
    case VK_NUMLOCK:
    case VK_SCROLL:
    case VK_PROCESSKEY:
    case VK_PACKET:
      return true;
    default:
      return false;
  }
}

inline unsigned ModifierOfKey(UINT virtualKey) noexcept {
  switch (virtualKey) {
    case VK_SHIFT:
    case VK_LSHIFT:
    case VK_RSHIFT:
      return ModifierShift;
    case VK_CONTROL:
    case VK_LCONTROL:
    case VK_RCONTROL:
      return ModifierControl;
    case VK_MENU:
    case VK_LMENU:
    case VK_RMENU:
      return ModifierOption;
    default:
      return 0;
  }
}

inline bool KeyDown(int virtualKey) noexcept {
  return (GetKeyState(virtualKey) & 0x8000) != 0;
}

inline unsigned HeldModifiers() noexcept {
  unsigned modifiers = 0;
  if (KeyDown(VK_CONTROL)) modifiers |= ModifierControl;
  if (KeyDown(VK_MENU)) modifiers |= ModifierOption;
  if (KeyDown(VK_SHIFT)) modifiers |= ModifierShift;
  return modifiers;
}

inline wchar_t FixedKeyOf(UINT virtualKey) noexcept {
  if (virtualKey >= 'A' && virtualKey <= 'Z') return static_cast<wchar_t>(virtualKey - 'A' + 'a');
  if (virtualKey >= '0' && virtualKey <= '9') return static_cast<wchar_t>(virtualKey);
  if (virtualKey >= VK_NUMPAD0 && virtualKey <= VK_NUMPAD9) return static_cast<wchar_t>('0' + (virtualKey - VK_NUMPAD0));
  if (virtualKey >= VK_F1 && virtualKey <= VK_F24) return static_cast<wchar_t>(kFunctionKeyF1 + (virtualKey - VK_F1));
  switch (virtualKey) {
    case VK_LEFT: return 0xF702;
    case VK_RIGHT: return 0xF703;
    case VK_UP: return 0xF700;
    case VK_DOWN: return 0xF701;
    case VK_PRIOR: return 0xF72C;
    case VK_NEXT: return 0xF72D;
    case VK_HOME: return 0xF729;
    case VK_END: return 0xF72B;
    case VK_DELETE: return 0xF728;
    case VK_INSERT: return 0xF727;
    case VK_BACK: return 0x08;
    case VK_TAB: return L'\t';
    case VK_RETURN: return L'\r';
    case VK_ESCAPE: return 0x1B;
    case VK_SPACE: return L' ';
    case VK_ADD: return L'+';
    case VK_SUBTRACT: return L'-';
    case VK_MULTIPLY: return L'*';
    case VK_DIVIDE: return L'/';
    case VK_DECIMAL: return L'.';
    default: return 0;
  }
}

inline wchar_t TypedCharacter(UINT virtualKey, UINT scanCode, std::initializer_list<int> held) noexcept {
  std::array<BYTE, 256> state{};
  for (int key : held) state[static_cast<size_t>(key)] = 0x80;
  wchar_t buffer[8]{};
  HKL layout = GetKeyboardLayout(0);
  int written = ToUnicodeEx(virtualKey, scanCode, state.data(), buffer, 8, 0x4, layout);
  if (written < 1) return 0;
  wchar_t typed = buffer[0];
  if (typed < 0x20 || typed == 0x7F) return 0;
  CharLowerBuffW(&typed, 1);
  return typed;
}

inline KeyPress ReadKeyPress(UINT virtualKey, LPARAM flags) noexcept {
  KeyPress press;
  press.virtualKey = virtualKey;
  press.modifiers = HeldModifiers();
  press.windowsKey = KeyDown(VK_LWIN) || KeyDown(VK_RWIN);
  press.fixed = FixedKeyOf(virtualKey);
  UINT scanCode = static_cast<UINT>((flags >> 16) & 0xFF);
  bool special = press.fixed != 0 && !(virtualKey >= 'A' && virtualKey <= 'Z') && !(virtualKey >= '0' && virtualKey <= '9');
  if (!special) {
    press.base = TypedCharacter(virtualKey, scanCode, {});
    press.shifted = TypedCharacter(virtualKey, scanCode, {VK_SHIFT, VK_LSHIFT});
  }
  if (KeyDown(VK_RMENU) && (press.modifiers & ModifierControl)) {
    wchar_t typed = (press.modifiers & ModifierShift)
        ? TypedCharacter(virtualKey, scanCode, {VK_CONTROL, VK_LCONTROL, VK_MENU, VK_RMENU, VK_SHIFT, VK_LSHIFT})
        : TypedCharacter(virtualKey, scanCode, {VK_CONTROL, VK_LCONTROL, VK_MENU, VK_RMENU});
    press.altGraph = typed != 0;
  }
  return press;
}

inline bool IsShiftedSymbol(wchar_t key) noexcept {
  if (!IsPrintableKey(key)) return false;
  wchar_t upper = key;
  wchar_t lower = key;
  CharUpperBuffW(&upper, 1);
  CharLowerBuffW(&lower, 1);
  return upper == lower;
}

inline bool Matches(Combo const &combo, KeyPress const &press) noexcept {
  if (combo.Empty()) return false;
  if (combo.modifiers == press.modifiers && (combo.key == press.fixed || (press.base && combo.key == press.base))) return true;
  if (!(press.modifiers & ModifierShift) || !press.shifted || combo.key != press.shifted) return false;
  if (combo.modifiers == press.modifiers) return true;
  return IsShiftedSymbol(combo.key) && static_cast<unsigned>(combo.modifiers | ModifierShift) == press.modifiers;
}

inline wchar_t RecordedKey(KeyPress const &press) noexcept {
  if (press.fixed) return press.fixed;
  return press.base;
}

inline std::wstring KeyLabel(wchar_t key) noexcept {
  if (IsFunctionKey(key)) return L"F" + std::to_wstring(key - kFunctionKeyF1 + 1);
  switch (key) {
    case 0xF702: return L"Left";
    case 0xF703: return L"Right";
    case 0xF700: return L"Up";
    case 0xF701: return L"Down";
    case 0xF72C: return L"PgUp";
    case 0xF72D: return L"PgDn";
    case 0xF729: return L"Home";
    case 0xF72B: return L"End";
    case 0xF728: return L"Del";
    case 0xF727: return L"Ins";
    case 0x08: return L"Backspace";
    case 0x7F: return L"Backspace";
    case L'\t': return L"Tab";
    case L'\r': return L"Enter";
    case 0x03: return L"Enter";
    case 0x1B: return L"Esc";
    case L' ': return L"Space";
    case L'+': return L"Plus";
    default: break;
  }
  if (!IsPrintableKey(key)) return {};
  wchar_t upper = key;
  CharUpperBuffW(&upper, 1);
  return std::wstring(1, upper);
}

inline std::wstring ComboLabel(Combo const &combo) noexcept {
  if (combo.Empty()) return {};
  std::wstring key = KeyLabel(combo.key);
  if (key.empty()) return {};
  std::wstring label;
  if (combo.modifiers & ModifierControl) label += L"Ctrl+";
  if (combo.modifiers & ModifierOption) label += L"Alt+";
  if (combo.modifiers & ModifierShift) label += L"Shift+";
  return label + key;
}

}
