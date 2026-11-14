#pragma once

#include <commctrl.h>
#include <shobjidl.h>

#include <optional>
#include <string>
#include <vector>

#include "ModalThread.h"

namespace Ardia {

namespace DialogParts {

using TaskDialogIndirectFunction = HRESULT(WINAPI *)(const TASKDIALOGCONFIG *, int *, int *, BOOL *);

inline TaskDialogIndirectFunction ResolveTaskDialog() noexcept {
  static TaskDialogIndirectFunction resolved = [] {
    HMODULE comctl = LoadLibraryW(L"comctl32.dll");
    return comctl ? reinterpret_cast<TaskDialogIndirectFunction>(GetProcAddress(comctl, "TaskDialogIndirect")) : nullptr;
  }();
  return resolved;
}

constexpr int ConfirmButtonId = 1001;

inline HRESULT CALLBACK ConfirmEvents(HWND dialog, UINT notification, WPARAM, LPARAM, LONG_PTR data) noexcept {
  auto *shown = reinterpret_cast<HWND *>(data);
  if (notification == TDN_CREATED) *shown = dialog;
  if (notification == TDN_DESTROYED) *shown = nullptr;
  return S_OK;
}

inline DialogConfirmReply ShowConfirm(HWND owner, std::wstring const &title, std::wstring const &message, std::wstring const &confirmTitle, std::wstring const &cancelTitle, bool destructive, std::optional<std::wstring> const &suppression) noexcept {
  DialogConfirmReply reply;
  ModalOverWindow modal(owner, "confirm");
  HWND shown = nullptr;
  ModalWatch::OnAbandon([&shown] {
    if (shown) SendMessageW(shown, TDM_CLICK_BUTTON, IDCANCEL, 0);
  });
  if (TaskDialogIndirectFunction taskDialog = ResolveTaskDialog()) {
    TASKDIALOG_BUTTON buttons[2] = {{ConfirmButtonId, confirmTitle.c_str()}, {IDCANCEL, cancelTitle.c_str()}};
    TASKDIALOGCONFIG config{};
    config.cbSize = sizeof(config);
    config.hwndParent = owner;
    config.hInstance = AppImage::Handle();
    config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | (owner ? TDF_POSITION_RELATIVE_TO_WINDOW : 0);
    config.pszWindowTitle = L"Ardia";
    config.pszMainInstruction = title.c_str();
    config.pszContent = message.empty() ? nullptr : message.c_str();
    if (destructive) config.pszMainIcon = TD_WARNING_ICON;
    config.cButtons = cancelTitle.empty() ? 1 : 2;
    config.pButtons = buttons;
    config.nDefaultButton = ConfirmButtonId;
    config.pfCallback = ConfirmEvents;
    config.lpCallbackData = reinterpret_cast<LONG_PTR>(&shown);
    if (suppression) config.pszVerificationText = suppression->c_str();
    int pressed = 0;
    BOOL checked = FALSE;
    if (SUCCEEDED(taskDialog(&config, &pressed, nullptr, &checked))) {
      reply.confirmed = pressed == ConfirmButtonId;
      reply.suppressed = suppression.has_value() && checked;
      return reply;
    }
  }
  std::wstring text = message.empty() ? title : title + L"\n\n" + message;
  UINT style = MB_OKCANCEL | MB_DEFBUTTON1 | (destructive ? MB_ICONWARNING : 0) | (owner ? MB_APPLMODAL : MB_TASKMODAL);
  reply.confirmed = MessageBoxW(owner, text.c_str(), L"Ardia", style) == IDOK;
  return reply;
}

struct PromptState {
  std::wstring title;
  std::wstring message;
  std::wstring value;
  std::wstring placeholder;
  std::wstring confirmTitle;
  std::wstring answer;
  HWND window = nullptr;
};

constexpr WORD PromptHeadingId = 99;
constexpr WORD PromptMessageId = 100;
constexpr WORD PromptFieldId = 101;

inline INT_PTR CALLBACK PromptProcedure(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  switch (message) {
    case WM_INITDIALOG: {
      SetWindowLongPtrW(dialog, DWLP_USER, lParam);
      auto *state = reinterpret_cast<PromptState *>(lParam);
      state->window = dialog;
      HWND field = GetDlgItem(dialog, PromptFieldId);
      SetWindowTextW(field, state->value.c_str());
      if (!state->placeholder.empty()) SendMessageW(field, EM_SETCUEBANNER, TRUE, reinterpret_cast<LPARAM>(state->placeholder.c_str()));
      SendMessageW(field, EM_SETSEL, 0, -1);
      SetFocus(field);
      return FALSE;
    }
    case WM_COMMAND: {
      WORD id = LOWORD(wParam);
      if (id == IDOK) {
        auto *state = reinterpret_cast<PromptState *>(GetWindowLongPtrW(dialog, DWLP_USER));
        HWND field = GetDlgItem(dialog, PromptFieldId);
        int length = GetWindowTextLengthW(field);
        std::wstring text(static_cast<size_t>(length) + 1, L'\0');
        int copied = GetWindowTextW(field, text.data(), length + 1);
        text.resize(static_cast<size_t>(copied > 0 ? copied : 0));
        if (state) state->answer = text;
        EndDialog(dialog, IDOK);
        return TRUE;
      }
      if (id == IDCANCEL) {
        EndDialog(dialog, IDCANCEL);
        return TRUE;
      }
      return FALSE;
    }
    default:
      return FALSE;
  }
}

struct DialogTemplateBuilder {
  std::vector<WORD> words;

  void Align() noexcept {
    if (words.size() % 2) words.push_back(0);
  }

  void Dword(DWORD value) noexcept {
    words.push_back(LOWORD(value));
    words.push_back(HIWORD(value));
  }

  void Text(std::wstring_view text) noexcept {
    for (wchar_t c : text) words.push_back(static_cast<WORD>(c));
    words.push_back(0);
  }

  void Item(DWORD style, short x, short y, short cx, short cy, WORD id, WORD atom, std::wstring_view text) noexcept {
    Align();
    Dword(style | WS_CHILD | WS_VISIBLE);
    Dword(0);
    words.push_back(static_cast<WORD>(x));
    words.push_back(static_cast<WORD>(y));
    words.push_back(static_cast<WORD>(cx));
    words.push_back(static_cast<WORD>(cy));
    words.push_back(id);
    words.push_back(0xFFFF);
    words.push_back(atom);
    Text(text);
    words.push_back(0);
  }
};

inline std::optional<std::wstring> ShowPrompt(HWND owner, PromptState &state) noexcept {
  ModalOverWindow modal(owner, "prompt");
  ModalWatch::OnAbandon([&state] {
    if (state.window) PostMessageW(state.window, WM_COMMAND, IDCANCEL, 0);
  });
  constexpr short width = 240;
  constexpr short margin = 7;
  constexpr short inner = width - margin * 2;
  short messageHeight = state.message.empty() ? 0 : static_cast<short>(8 * std::min<size_t>(6, 1 + state.message.size() / 48));
  short headingY = margin;
  short messageY = headingY + 10 + 4;
  short fieldY = messageY + messageHeight + (messageHeight ? 6 : 0);
  short buttonsY = fieldY + 14 + 10;
  short height = buttonsY + 14 + margin;
  WORD itemCount = state.message.empty() ? 4 : 5;

  DialogTemplateBuilder builder;
  builder.Dword(DS_SETFONT | DS_MODALFRAME | DS_CENTER | WS_POPUP | WS_CAPTION | WS_SYSMENU);
  builder.Dword(0);
  builder.words.push_back(itemCount);
  builder.words.push_back(0);
  builder.words.push_back(0);
  builder.words.push_back(static_cast<WORD>(width));
  builder.words.push_back(static_cast<WORD>(height));
  builder.words.push_back(0);
  builder.words.push_back(0);
  builder.Text(L"Ardia");
  builder.words.push_back(9);
  builder.Text(L"Segoe UI");
  builder.Item(SS_LEFT | SS_NOPREFIX, margin, headingY, inner, 10, PromptHeadingId, 0x0082, state.title);
  if (!state.message.empty()) builder.Item(SS_LEFT | SS_NOPREFIX, margin, messageY, inner, messageHeight, PromptMessageId, 0x0082, state.message);
  builder.Item(WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, margin, fieldY, inner, 14, PromptFieldId, 0x0081, L"");
  builder.Item(BS_DEFPUSHBUTTON | WS_TABSTOP, width - margin - 50 - 4 - 50, buttonsY, 50, 14, IDOK, 0x0080, state.confirmTitle);
  builder.Item(BS_PUSHBUTTON | WS_TABSTOP, width - margin - 50, buttonsY, 50, 14, IDCANCEL, 0x0080, L"Cancel");
  builder.Align();

  INT_PTR result = DialogBoxIndirectParamW(AppImage::Handle(), reinterpret_cast<LPCDLGTEMPLATEW>(builder.words.data()), owner, PromptProcedure, reinterpret_cast<LPARAM>(&state));
  if (result != IDOK) return std::nullopt;
  return state.answer;
}

inline std::wstring ItemPath(IShellItem *item) noexcept {
  if (!item) return {};
  PWSTR raw = nullptr;
  std::wstring path;
  if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &raw)) && raw) path = raw;
  if (raw) CoTaskMemFree(raw);
  return path;
}

inline std::vector<std::wstring> ShowOpenFiles(HWND owner) noexcept {
  std::vector<std::wstring> picked;
  ModalOverWindow modal(owner, "file picker");
  winrt::com_ptr<IFileOpenDialog> dialog;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileOpenDialog), dialog.put_void())) || !dialog) return picked;
  FILEOPENDIALOGOPTIONS options = 0;
  dialog->GetOptions(&options);
  dialog->SetOptions(options | FOS_ALLOWMULTISELECT | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST);
  ModalWatch::OnAbandon([shown = dialog.get()] { shown->Close(HRESULT_FROM_WIN32(ERROR_CANCELLED)); });
  if (FAILED(dialog->Show(owner))) return picked;
  winrt::com_ptr<IShellItemArray> results;
  if (FAILED(dialog->GetResults(results.put())) || !results) return picked;
  DWORD count = 0;
  results->GetCount(&count);
  for (DWORD i = 0; i < count; i++) {
    winrt::com_ptr<IShellItem> item;
    if (SUCCEEDED(results->GetItemAt(i, item.put()))) {
      std::wstring path = ItemPath(item.get());
      if (!path.empty()) picked.push_back(path);
    }
  }
  return picked;
}

inline std::optional<std::wstring> ShowOpenFolder(HWND owner, std::optional<std::wstring> const &current, std::optional<std::wstring> const &prompt) noexcept {
  ModalOverWindow modal(owner, "folder picker");
  winrt::com_ptr<IFileOpenDialog> dialog;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileOpenDialog), dialog.put_void())) || !dialog) return std::nullopt;
  FILEOPENDIALOGOPTIONS options = 0;
  dialog->GetOptions(&options);
  dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
  if (prompt && !prompt->empty()) dialog->SetOkButtonLabel(prompt->c_str());
  if (current && !current->empty()) {
    winrt::com_ptr<IShellItem> folder;
    if (SUCCEEDED(SHCreateItemFromParsingName(current->c_str(), nullptr, __uuidof(IShellItem), folder.put_void())) && folder) dialog->SetFolder(folder.get());
  }
  ModalWatch::OnAbandon([shown = dialog.get()] { shown->Close(HRESULT_FROM_WIN32(ERROR_CANCELLED)); });
  if (FAILED(dialog->Show(owner))) return std::nullopt;
  winrt::com_ptr<IShellItem> result;
  if (FAILED(dialog->GetResult(result.put())) || !result) return std::nullopt;
  std::wstring path = ItemPath(result.get());
  if (path.empty()) return std::nullopt;
  return path;
}

}

}
