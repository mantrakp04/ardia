#pragma once

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include <commctrl.h>
#include <shobjidl.h>

#include "NativeModules.h"
#include "AppImage.h"
#include "Events.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "WindowManager.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "uuid.lib")
#pragma comment(lib, "user32.lib")

namespace Ardia {

REACT_STRUCT(DialogConfirmOptions)
struct DialogConfirmOptions {
  REACT_FIELD(title)
  std::string title;
  REACT_FIELD(message)
  std::optional<std::string> message;
  REACT_FIELD(confirmTitle)
  std::optional<std::string> confirmTitle;
  REACT_FIELD(cancelTitle)
  std::optional<std::string> cancelTitle;
  REACT_FIELD(destructive)
  std::optional<bool> destructive;
  REACT_FIELD(suppression)
  std::optional<std::string> suppression;
  REACT_FIELD(windowId)
  std::optional<std::string> windowId;
};

REACT_STRUCT(DialogPromptOptions)
struct DialogPromptOptions {
  REACT_FIELD(title)
  std::string title;
  REACT_FIELD(message)
  std::optional<std::string> message;
  REACT_FIELD(value)
  std::optional<std::string> value;
  REACT_FIELD(placeholder)
  std::optional<std::string> placeholder;
  REACT_FIELD(confirmTitle)
  std::optional<std::string> confirmTitle;
  REACT_FIELD(windowId)
  std::optional<std::string> windowId;
};

REACT_STRUCT(DialogConfirmReply)
struct DialogConfirmReply {
  REACT_FIELD(confirmed)
  bool confirmed = false;
  REACT_FIELD(suppressed)
  bool suppressed = false;
};

namespace DialogParts {

inline std::atomic<int> &OpenCount() noexcept {
  static std::atomic<int> count{0};
  return count;
}

struct OpenDialogScope {
  OpenDialogScope() noexcept { OpenCount()++; }
  ~OpenDialogScope() noexcept { OpenCount()--; }
  OpenDialogScope(OpenDialogScope const &) = delete;
  OpenDialogScope &operator=(OpenDialogScope const &) = delete;
};

inline bool IsPageWindow(HWND window) noexcept {
  wchar_t name[64]{};
  GetClassNameW(window, name, 64);
  return std::wstring_view{name}.starts_with(L"Chrome_WidgetWin_");
}

struct HeldPageWindows {
  explicit HeldPageWindows(HWND owner) noexcept : m_owner(owner) {
    if (!owner) return;
    EnumWindows(&HeldPageWindows::Collect, reinterpret_cast<LPARAM>(this));
    for (HWND page : m_pages) EnableWindow(page, FALSE);
  }
  ~HeldPageWindows() noexcept {
    for (HWND page : m_pages)
      if (IsWindow(page) && GetWindow(page, GW_OWNER) == m_owner) EnableWindow(page, TRUE);
  }
  HeldPageWindows(HeldPageWindows const &) = delete;
  HeldPageWindows &operator=(HeldPageWindows const &) = delete;

  size_t Count() const noexcept { return m_pages.size(); }

 private:
  static BOOL CALLBACK Collect(HWND window, LPARAM self) noexcept {
    auto *held = reinterpret_cast<HeldPageWindows *>(self);
    DWORD process = 0;
    GetWindowThreadProcessId(window, &process);
    if (process == GetCurrentProcessId() && GetWindow(window, GW_OWNER) == held->m_owner && IsWindowEnabled(window) && IsPageWindow(window)) held->m_pages.push_back(window);
    return TRUE;
  }

  HWND m_owner;
  std::vector<HWND> m_pages;
};

inline bool Background() noexcept {
  return Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
}

inline std::string Trimmed(std::string_view text) noexcept {
  constexpr std::string_view blank = " \t\r\n\v\f";
  size_t start = text.find_first_not_of(blank);
  if (start == std::string_view::npos) return {};
  size_t end = text.find_last_not_of(blank);
  return std::string{text.substr(start, end - start + 1)};
}

inline std::vector<std::string> Split(std::string_view text, char separator) noexcept {
  std::vector<std::string> pieces;
  size_t start = 0;
  while (true) {
    size_t at = text.find(separator, start);
    pieces.emplace_back(text.substr(start, at == std::string_view::npos ? std::string_view::npos : at - start));
    if (at == std::string_view::npos) break;
    start = at + 1;
  }
  return pieces;
}

inline std::optional<std::string> TestValue(std::string_view key) noexcept {
  if (!Paths::HasCustomDataDirectory()) return std::nullopt;
  std::string requested = Paths::Utf8(Paths::Environment(L"ARDIA_TEST"));
  for (std::string const &piece : Split(requested, ',')) {
    size_t equals = piece.find('=');
    std::string name = Trimmed(std::string_view{piece}.substr(0, equals));
    if (name != key) continue;
    return equals == std::string::npos ? std::string{"1"} : Trimmed(std::string_view{piece}.substr(equals + 1));
  }
  return std::nullopt;
}

inline bool TestFlag(std::string_view key) noexcept {
  std::optional<std::string> value = TestValue(key);
  return value && *value != "0" && *value != "off" && *value != "false";
}

inline std::string JsonQuoted(std::string_view text) noexcept {
  std::string quoted = "\"";
  for (unsigned char c : text) {
    switch (c) {
      case '"': quoted += "\\\""; break;
      case '\\': quoted += "\\\\"; break;
      case '\n': quoted += "\\n"; break;
      case '\r': quoted += "\\r"; break;
      case '\t': quoted += "\\t"; break;
      case '\b': quoted += "\\b"; break;
      case '\f': quoted += "\\f"; break;
      default:
        if (c < 0x20) {
          char escaped[8];
          snprintf(escaped, sizeof(escaped), "\\u%04x", c);
          quoted += escaped;
        } else {
          quoted.push_back(static_cast<char>(c));
        }
    }
  }
  quoted += "\"";
  return quoted;
}

struct JsonEntry {
  std::string key;
  std::string json;
};

inline std::string PrettyJson(std::vector<JsonEntry> entries) noexcept {
  std::sort(entries.begin(), entries.end(), [](JsonEntry const &a, JsonEntry const &b) { return a.key < b.key; });
  std::string text = "{\n";
  for (size_t i = 0; i < entries.size(); i++) {
    text += "  " + JsonQuoted(entries[i].key) + " : " + entries[i].json;
    text += i + 1 < entries.size() ? ",\n" : "\n";
  }
  text += "}";
  return text;
}

inline std::optional<std::string> ReadWholeFile(std::filesystem::path const &path) noexcept {
  try {
    std::ifstream file(path, std::ios::binary);
    if (!file) return std::nullopt;
    std::ostringstream contents;
    contents << file.rdbuf();
    return contents.str();
  } catch (...) {
    return std::nullopt;
  }
}

inline void WriteWholeFile(std::filesystem::path const &path, std::string const &contents) noexcept {
  try {
    std::filesystem::path partial = path;
    partial += L".partial";
    {
      std::ofstream file(partial, std::ios::binary | std::ios::trunc);
      if (!file) return;
      file.write(contents.data(), static_cast<std::streamsize>(contents.size()));
    }
    std::error_code ignored;
    std::filesystem::rename(partial, path, ignored);
  } catch (...) {
  }
}

inline std::optional<std::string> TestAnswer(std::vector<JsonEntry> dumped) noexcept {
  if (!TestFlag("appDialog")) return std::nullopt;
  std::filesystem::path file = Paths::DataDirectory() / L"dialog.json";
  WriteWholeFile(file, PrettyJson(std::move(dumped)));
  std::filesystem::path pickFile = file;
  pickFile += L".pick";
  std::optional<std::string> pick = ReadWholeFile(pickFile);
  std::error_code ignored;
  std::filesystem::remove(pickFile, ignored);
  if (!pick) return std::nullopt;
  return Trimmed(*pick);
}

inline void Log(std::string const &what) noexcept {
  LaunchLog::Write(L"info", Paths::Wide(what));
  try {
    std::time_t now = std::time(nullptr);
    std::tm local{};
    localtime_s(&local, &now);
    char stamp[64];
    std::strftime(stamp, sizeof(stamp), "%Y-%m-%d %H:%M:%S %z", &local);
    std::ofstream file(Paths::DataDirectory() / L"activation.log", std::ios::binary | std::ios::app);
    if (file) file << stamp << " " << what << "\n";
  } catch (...) {
  }
}

struct ModalOverWindow {
  ModalOverWindow(HWND owner, std::string_view kind) noexcept : pages(owner) {
    if (pages.Count()) LaunchLog::Write(L"info", Paths::Wide(std::string{kind} + " holds " + std::to_string(pages.Count()) + " page window(s) until it closes"));
  }
  OpenDialogScope open;
  HeldPageWindows pages;
};

inline std::vector<std::wstring> TakePicks() noexcept {
  std::filesystem::path path = Paths::DataDirectory() / L"file-chooser.txt";
  std::optional<std::string> text = ReadWholeFile(path);
  if (!text) return {};
  std::error_code ignored;
  std::filesystem::remove(path, ignored);
  std::vector<std::wstring> picks;
  std::string line;
  for (char c : *text) {
    if (c == '\n' || c == '\r') {
      if (!line.empty()) picks.push_back(Paths::Wide(line));
      line.clear();
    } else {
      line.push_back(c);
    }
  }
  if (!line.empty()) picks.push_back(Paths::Wide(line));
  return picks;
}

inline std::string FileUrl(std::wstring const &path) noexcept {
  std::string utf8 = Paths::Utf8(path);
  for (char &c : utf8)
    if (c == '\\') c = '/';
  std::string prefix = "file:///";
  std::string_view rest{utf8};
  if (rest.starts_with("//")) {
    prefix = "file://";
    rest.remove_prefix(2);
  } else if (rest.starts_with("/")) {
    rest.remove_prefix(1);
  }
  static constexpr char digits[] = "0123456789ABCDEF";
  std::string url = prefix;
  for (unsigned char c : rest) {
    bool plain = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
        std::string_view{"-._~/:!$&'()*+,;=@"}.find(static_cast<char>(c)) != std::string_view::npos;
    if (plain) {
      url.push_back(static_cast<char>(c));
    } else {
      url.push_back('%');
      url.push_back(digits[c >> 4]);
      url.push_back(digits[c & 0xF]);
    }
  }
  return url;
}

inline HWND Owner(std::optional<std::string> const &windowId) noexcept {
  HWND owner = nullptr;
  if (windowId && !windowId->empty()) owner = WindowManager::Shared().Hwnd(*windowId);
  if (owner && !IsWindowVisible(owner)) owner = nullptr;
  if (!owner) owner = WindowManager::Shared().ActiveHwnd();
  return owner;
}

inline size_t EscapeButton(std::vector<std::string> const &titles) noexcept {
  for (size_t i = 0; i < titles.size(); i++)
    if (titles[i] == "Cancel") return i;
  return titles.empty() ? 0 : titles.size() - 1;
}

inline std::string AnswerAlertInBackground(std::string const &title, std::string const &message, std::vector<std::string> const &titles, size_t &pick) noexcept {
  pick = EscapeButton(titles);
  std::string joined;
  for (size_t i = 0; i < titles.size(); i++) joined += (i ? ", " : "") + titles[i];
  std::string chosen = titles.empty() ? std::string{"OK"} : titles[pick];
  Log("alert (not shown): app-modal | \"" + title + "\" | \"" + message + "\" | buttons " + joined + " | chose " + chosen);
  return chosen;
}

using TaskDialogIndirectFunction = HRESULT(WINAPI *)(const TASKDIALOGCONFIG *, int *, int *, BOOL *);

inline TaskDialogIndirectFunction ResolveTaskDialog() noexcept {
  static TaskDialogIndirectFunction resolved = [] {
    HMODULE comctl = LoadLibraryW(L"comctl32.dll");
    return comctl ? reinterpret_cast<TaskDialogIndirectFunction>(GetProcAddress(comctl, "TaskDialogIndirect")) : nullptr;
  }();
  return resolved;
}

constexpr int ConfirmButtonId = 1001;

inline DialogConfirmReply ShowConfirm(HWND owner, std::wstring const &title, std::wstring const &message, std::wstring const &confirmTitle, std::wstring const &cancelTitle, bool destructive, std::optional<std::wstring> const &suppression) noexcept {
  DialogConfirmReply reply;
  ModalOverWindow modal(owner, "confirm");
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
};

constexpr WORD PromptHeadingId = 99;
constexpr WORD PromptMessageId = 100;
constexpr WORD PromptFieldId = 101;

inline INT_PTR CALLBACK PromptProcedure(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  switch (message) {
    case WM_INITDIALOG: {
      SetWindowLongPtrW(dialog, DWLP_USER, lParam);
      auto *state = reinterpret_cast<PromptState *>(lParam);
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

struct ComApartment {
  bool owned = false;
  ComApartment() noexcept {
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    owned = SUCCEEDED(result);
  }
  ~ComApartment() noexcept {
    if (owned) CoUninitialize();
  }
  ComApartment(ComApartment const &) = delete;
  ComApartment &operator=(ComApartment const &) = delete;
};

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
  ComApartment apartment;
  ModalOverWindow modal(owner, "file picker");
  winrt::com_ptr<IFileOpenDialog> dialog;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, __uuidof(IFileOpenDialog), dialog.put_void())) || !dialog) return picked;
  FILEOPENDIALOGOPTIONS options = 0;
  dialog->GetOptions(&options);
  dialog->SetOptions(options | FOS_ALLOWMULTISELECT | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST);
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
  ComApartment apartment;
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
  if (FAILED(dialog->Show(owner))) return std::nullopt;
  winrt::com_ptr<IShellItem> result;
  if (FAILED(dialog->GetResult(result.put())) || !result) return std::nullopt;
  std::wstring path = ItemPath(result.get());
  if (path.empty()) return std::nullopt;
  return path;
}

inline std::string DescribeOpenPanel(bool multiple, bool files, bool directories, std::optional<std::string> const &directory) noexcept {
  std::string text = "open panel (not shown): free-standing | multiple=" + std::to_string(multiple ? 1 : 0) + " files=" + std::to_string(files ? 1 : 0) +
      " directories=" + std::to_string(directories ? 1 : 0) + " | types=* others=1";
  if (directory && !directory->empty()) text += " | directory=" + *directory;
  return text;
}

inline std::string JoinedUtf8(std::vector<std::wstring> const &paths) noexcept {
  std::string joined;
  for (size_t i = 0; i < paths.size(); i++) joined += (i ? ", " : "") + Paths::Utf8(paths[i]);
  return joined;
}

}

}

#include "SaveDialog.h"

namespace Ardia {

REACT_MODULE(DialogsModule, L"ArdiaDialogs")
struct DialogsModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  static int OpenCount() noexcept {
    return DialogParts::OpenCount().load();
  }

  REACT_METHOD(confirm)
  void confirm(DialogConfirmOptions options, winrt::Microsoft::ReactNative::ReactPromise<DialogConfirmReply> promise) noexcept {
    std::string message = options.message.value_or("");
    std::string confirmTitle = options.confirmTitle.value_or("OK");
    std::string cancelTitle = options.cancelTitle.value_or("Cancel");
    bool destructive = options.destructive.value_or(false);

    std::vector<DialogParts::JsonEntry> dumped{
        {"kind", DialogParts::JsonQuoted("confirm")},
        {"title", DialogParts::JsonQuoted(options.title)},
        {"message", DialogParts::JsonQuoted(message)},
        {"confirmTitle", DialogParts::JsonQuoted(confirmTitle)},
        {"cancelTitle", DialogParts::JsonQuoted(cancelTitle)},
        {"destructive", destructive ? "true" : "false"},
    };
    if (options.suppression) dumped.push_back({"suppression", DialogParts::JsonQuoted(*options.suppression)});
    if (options.windowId) dumped.push_back({"windowId", DialogParts::JsonQuoted(*options.windowId)});
    if (std::optional<std::string> answer = DialogParts::TestAnswer(std::move(dumped))) {
      DialogConfirmReply reply;
      for (std::string const &word : DialogParts::Split(*answer, ',')) {
        std::string trimmed = DialogParts::Trimmed(word);
        if (trimmed == "confirm") reply.confirmed = true;
        if (trimmed == "suppress") reply.suppressed = true;
      }
      promise.Resolve(reply);
      return;
    }

    if (DialogParts::Background()) {
      size_t pick = 0;
      DialogParts::AnswerAlertInBackground(options.title, message, {confirmTitle, cancelTitle}, pick);
      DialogConfirmReply reply;
      reply.confirmed = pick == 0;
      reply.suppressed = false;
      promise.Resolve(reply);
      return;
    }

    std::optional<std::wstring> suppression;
    if (options.suppression) suppression = Paths::Wide(*options.suppression);
    std::wstring title = Paths::Wide(options.title);
    std::wstring wideMessage = Paths::Wide(message);
    std::wstring wideConfirm = Paths::Wide(confirmTitle);
    std::wstring wideCancel = Paths::Wide(cancelTitle);
    std::optional<std::string> windowId = options.windowId;
    RunOnUI(m_context, [promise, title, wideMessage, wideConfirm, wideCancel, destructive, suppression, windowId]() noexcept {
      try {
        promise.Resolve(DialogParts::ShowConfirm(DialogParts::Owner(windowId), title, wideMessage, wideConfirm, wideCancel, destructive, suppression));
      } catch (...) {
        promise.Reject("confirm failed");
      }
    });
  }

  REACT_METHOD(prompt)
  void prompt(DialogPromptOptions options, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    std::string message = options.message.value_or("");
    std::string value = options.value.value_or("");
    std::string confirmTitle = options.confirmTitle.value_or("OK");

    std::vector<DialogParts::JsonEntry> dumped{
        {"kind", DialogParts::JsonQuoted("prompt")},
        {"title", DialogParts::JsonQuoted(options.title)},
        {"message", DialogParts::JsonQuoted(message)},
        {"value", DialogParts::JsonQuoted(value)},
        {"confirmTitle", DialogParts::JsonQuoted(confirmTitle)},
    };
    if (options.placeholder) dumped.push_back({"placeholder", DialogParts::JsonQuoted(*options.placeholder)});
    if (options.windowId) dumped.push_back({"windowId", DialogParts::JsonQuoted(*options.windowId)});
    if (std::optional<std::string> answer = DialogParts::TestAnswer(std::move(dumped))) {
      promise.Resolve(answer->empty() ? std::nullopt : answer);
      return;
    }

    if (DialogParts::Background()) {
      size_t pick = 0;
      DialogParts::AnswerAlertInBackground(options.title, message, {confirmTitle, "Cancel"}, pick);
      std::string text = DialogParts::Trimmed(value);
      promise.Resolve(pick == 0 && !text.empty() ? std::optional<std::string>{text} : std::nullopt);
      return;
    }

    auto state = std::make_shared<DialogParts::PromptState>();
    state->title = Paths::Wide(options.title);
    state->message = Paths::Wide(message);
    state->value = Paths::Wide(value);
    state->placeholder = Paths::Wide(options.placeholder.value_or(""));
    state->confirmTitle = Paths::Wide(confirmTitle);
    std::optional<std::string> windowId = options.windowId;
    RunOnUI(m_context, [promise, state, windowId]() noexcept {
      try {
        std::optional<std::wstring> answer = DialogParts::ShowPrompt(DialogParts::Owner(windowId), *state);
        std::string text = answer ? DialogParts::Trimmed(Paths::Utf8(*answer)) : std::string{};
        promise.Resolve(text.empty() ? std::nullopt : std::optional<std::string>{text});
      } catch (...) {
        promise.Reject("prompt failed");
      }
    });
  }

  REACT_METHOD(pickFiles)
  void pickFiles(winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept {
    if (DialogParts::Background()) {
      std::vector<std::wstring> picks = DialogParts::TakePicks();
      DialogParts::Log(DialogParts::DescribeOpenPanel(true, true, false, std::nullopt) + " | " + (picks.empty() ? std::string{"cancelled"} : "chose " + DialogParts::JoinedUtf8(picks)));
      std::vector<std::string> urls;
      for (std::wstring const &path : picks) urls.push_back(DialogParts::FileUrl(path));
      promise.Resolve(urls);
      return;
    }
    RunOnUI(m_context, [promise]() noexcept {
      try {
        std::vector<std::string> urls;
        for (std::wstring const &path : DialogParts::ShowOpenFiles(WindowManager::Shared().ActiveHwnd())) urls.push_back(DialogParts::FileUrl(path));
        promise.Resolve(urls);
      } catch (...) {
        promise.Reject("pickFiles failed");
      }
    });
  }

  REACT_METHOD(saveFile)
  void saveFile(std::string name, std::string extension, std::string kind, std::string message, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    DialogParts::SaveRequest request{Paths::Wide(name), Paths::Wide(extension), Paths::Wide(kind), Paths::Wide(message)};
    if (DialogParts::Background()) {
      std::vector<std::wstring> picks = DialogParts::TakePicks();
      DialogParts::Log(DialogParts::DescribeSavePanel(request) + " | " + (picks.empty() ? std::string{"cancelled"} : std::string{"chose a file"}));
      promise.Resolve(picks.empty() ? std::nullopt : std::optional<std::string>{Paths::Utf8(picks.front())});
      return;
    }
    RunOnUI(m_context, [promise, request]() noexcept {
      try {
        std::optional<std::wstring> path = DialogParts::ShowSaveFile(WindowManager::Shared().ActiveHwnd(), request);
        promise.Resolve(path ? std::optional<std::string>{Paths::Utf8(*path)} : std::nullopt);
      } catch (...) {
        promise.Reject("saveFile failed");
      }
    });
  }

  REACT_METHOD(pickFolder)
  void pickFolder(std::optional<std::string> current, std::optional<std::string> prompt, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    if (DialogParts::Background()) {
      std::vector<std::wstring> picks = DialogParts::TakePicks();
      DialogParts::Log(DialogParts::DescribeOpenPanel(false, false, true, current) + " | " + (picks.empty() ? std::string{"cancelled"} : "chose " + DialogParts::JoinedUtf8(picks)));
      promise.Resolve(picks.empty() ? std::nullopt : std::optional<std::string>{Paths::Utf8(picks.front())});
      return;
    }
    std::optional<std::wstring> wideCurrent;
    if (current) wideCurrent = Paths::Wide(*current);
    std::optional<std::wstring> widePrompt;
    if (prompt) widePrompt = Paths::Wide(*prompt);
    RunOnUI(m_context, [promise, wideCurrent, widePrompt]() noexcept {
      try {
        std::optional<std::wstring> path = DialogParts::ShowOpenFolder(WindowManager::Shared().ActiveHwnd(), wideCurrent, widePrompt);
        promise.Resolve(path ? std::optional<std::string>{Paths::Utf8(*path)} : std::nullopt);
      } catch (...) {
        promise.Reject("pickFolder failed");
      }
    });
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
