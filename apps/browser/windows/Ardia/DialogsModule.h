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
#include "LaunchConfig.h"
#include "ModalThread.h"
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
  explicit HeldPageWindows(HWND owner) noexcept : m_owner(owner) { Refresh(); }

  void Refresh() noexcept {
    if (!m_owner) return;
    size_t before = m_pages.size();
    EnumWindows(&HeldPageWindows::Collect, reinterpret_cast<LPARAM>(this));
    for (size_t i = before; i < m_pages.size(); i++) EnableWindow(m_pages[i], FALSE);
  }
  ~HeldPageWindows() noexcept { Release(); }

  void Release() noexcept {
    for (HWND page : m_pages)
      if (IsWindow(page) && GetWindow(page, GW_OWNER) == m_owner) EnableWindow(page, TRUE);
    m_pages.clear();
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
  return AppLaunch::Background();
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

inline bool TestFlag(std::string_view key) noexcept {
  return AppLaunch::TestFlag(key);
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
  ModalOverWindow(HWND owner, std::string_view kind) noexcept : watch(owner), pages(owner), parent(owner) {
    if (pages.Count()) LaunchLog::Write(L"info", Paths::Wide(std::string{kind} + " holds " + std::to_string(pages.Count()) + " page window(s) until it closes"));
    ModalWatch::OnTick([this] {
      pages.Refresh();
      parent.KeepDialogAboveOwner();
    });
  }
  ~ModalOverWindow() noexcept {
    ModalWatch::OnTick(nullptr);
    pages.Release();
    parent.Release();
  }
  ModalOverWindow(ModalOverWindow const &) = delete;
  ModalOverWindow &operator=(ModalOverWindow const &) = delete;

  HWND Parent() const noexcept { return parent.Handle(); }

  ModalWatch watch;
  OpenDialogScope open;
  HeldPageWindows pages;
  ModalParent parent;
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

#include "NativeDialogs.h"
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

  REACT_SYNC_METHOD(openCount)
  int openCount() noexcept {
    return DialogParts::OpenCount().load();
  }

  REACT_METHOD(devHoldConfirm)
  void devHoldConfirm(std::string windowId, bool onUiThread, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (!AppLaunch::Shared().testInstance) return promise.Reject("held dialogs are for test instances only");
    RunOnUI(m_context, [promise, windowId, onUiThread]() noexcept {
      HWND owner = DialogParts::Owner(windowId);
      auto hold = [owner]() noexcept {
        return DialogParts::ShowConfirm(owner, L"Self-check: a held confirm", L"", L"OK", L"Cancel", false, std::nullopt).confirmed;
      };
      if (onUiThread) return promise.Resolve(hold());
      bool started = DialogParts::RunModal(owner, [promise, hold](bool usable) noexcept {
        bool confirmed = usable && hold();
        if (!DialogParts::Stopping()) promise.Resolve(confirmed);
      });
      if (!started) promise.Resolve(false);
    });
  }

  REACT_METHOD(devReleaseDialogs)
  void devReleaseDialogs() noexcept {
    if (AppLaunch::Shared().testInstance) DialogParts::ReleaseAllModals();
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
      HWND owner = DialogParts::Owner(windowId);
      bool started = DialogParts::RunModal(owner, [promise, owner, title, wideMessage, wideConfirm, wideCancel, destructive, suppression](bool usable) noexcept {
        DialogConfirmReply reply = usable ? DialogParts::ShowConfirm(owner, title, wideMessage, wideConfirm, wideCancel, destructive, suppression) : DialogConfirmReply{};
        if (!DialogParts::Stopping()) promise.Resolve(reply);
      });
      if (!started) promise.Resolve(DialogConfirmReply{});
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
      HWND owner = DialogParts::Owner(windowId);
      bool started = DialogParts::RunModal(owner, [promise, owner, state](bool usable) noexcept {
        std::optional<std::wstring> answer = usable ? DialogParts::ShowPrompt(owner, *state) : std::nullopt;
        std::string text = answer ? DialogParts::Trimmed(Paths::Utf8(*answer)) : std::string{};
        if (!DialogParts::Stopping()) promise.Resolve(text.empty() ? std::nullopt : std::optional<std::string>{text});
      });
      if (!started) promise.Resolve(std::nullopt);
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
      HWND owner = WindowManager::Shared().ActiveHwnd();
      bool started = DialogParts::RunModal(owner, [promise, owner](bool usable) noexcept {
        std::vector<std::string> urls;
        if (usable)
          for (std::wstring const &path : DialogParts::ShowOpenFiles(owner)) urls.push_back(DialogParts::FileUrl(path));
        if (!DialogParts::Stopping()) promise.Resolve(urls);
      });
      if (!started) promise.Resolve(std::vector<std::string>{});
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
      HWND owner = WindowManager::Shared().ActiveHwnd();
      bool started = DialogParts::RunModal(owner, [promise, owner, request](bool usable) noexcept {
        std::optional<std::wstring> path = usable ? DialogParts::ShowSaveFile(owner, request) : std::nullopt;
        if (!DialogParts::Stopping()) promise.Resolve(path ? std::optional<std::string>{Paths::Utf8(*path)} : std::nullopt);
      });
      if (!started) promise.Resolve(std::nullopt);
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
      HWND owner = WindowManager::Shared().ActiveHwnd();
      bool started = DialogParts::RunModal(owner, [promise, owner, wideCurrent, widePrompt](bool usable) noexcept {
        std::optional<std::wstring> path = usable ? DialogParts::ShowOpenFolder(owner, wideCurrent, widePrompt) : std::nullopt;
        if (!DialogParts::Stopping()) promise.Resolve(path ? std::optional<std::string>{Paths::Utf8(*path)} : std::nullopt);
      });
      if (!started) promise.Resolve(std::nullopt);
    });
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
