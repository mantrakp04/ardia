#pragma once

#include <shlobj.h>
#include <winrt/Windows.Data.Json.h>

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "NativeModules.h"

#include "AppModule.h"
#include "Events.h"
#include "Host.h"
#include "ImportFiles.h"
#include "ImportSecrets.h"
#include "Paths.h"

namespace Ardia {

namespace ImportParts {

using Promise = winrt::Microsoft::ReactNative::ReactPromise<std::string>;
using MaybeText = winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>>;

inline std::wstring SourceOverride() noexcept {
  if (!Paths::HasCustomDataDirectory()) return {};
  try {
    auto const &settings = AppLaunch::Shared().instance;
    auto found = settings.find("importSourceDir");
    return found == settings.end() ? std::wstring{} : Paths::Wide(found->second);
  } catch (...) {
    return {};
  }
}

inline std::string Folder(REFKNOWNFOLDERID known, const wchar_t *variable, const wchar_t *underOverride) noexcept {
  std::wstring custom = SourceOverride();
  if (!custom.empty()) return Paths::Utf8((std::filesystem::path{custom} / underOverride).wstring());
  return Paths::Utf8(Paths::UserFolder(known, variable).wstring());
}

inline void RemoveLeftovers() noexcept {
  std::error_code ignored;
  auto temp = std::filesystem::temp_directory_path(ignored);
  if (temp.empty()) return;
  auto cutoff = std::filesystem::file_time_type::clock::now() - std::chrono::hours(1);
  for (auto it = std::filesystem::directory_iterator(temp, ignored); !ignored && it != std::filesystem::directory_iterator(); it.increment(ignored)) {
    std::wstring name = it->path().filename().wstring();
    if (name.rfind(L"ardia-import-", 0) != 0) continue;
    std::error_code timeError;
    auto written = std::filesystem::last_write_time(it->path(), timeError);
    if (!timeError && written < cutoff) std::filesystem::remove_all(it->path(), timeError);
  }
}

struct Writing {
  winrt::Microsoft::ReactNative::ReactContext context{nullptr};
  std::shared_ptr<ImportSecrets::VaultEntry> entry;
  std::string profile;
  size_t next = 0;
  int64_t imported = 0;
  int64_t rejected = 0;
  int64_t existing = 0;
  std::string error;
  Promise promise;
};

inline void Finish(std::unique_ptr<Writing> writing) noexcept {
  try {
    std::string out = "{\"cookies\":" + std::to_string(writing->imported) +
                      ",\"cookiesRejected\":" + std::to_string(writing->rejected + static_cast<int64_t>(writing->entry->dropped)) +
                      ",\"cookiesExisting\":" + std::to_string(writing->existing) + ",\"addresses\":0,\"cards\":0";
    if (!writing->error.empty()) out.append(",\"cookiesFailed\":1,\"error\":").append(ImportFiles::JsonString(writing->error));
    out.push_back('}');
    for (auto &batch : writing->entry->batches) batch->Wipe();
    writing->promise.Resolve(out);
  } catch (...) {
    writing->promise.Reject("the cookies could not be written");
  }
}

inline void Step(std::unique_ptr<Writing> writing) noexcept;

inline void OnBatchReply(void *context, const char *json) noexcept {
  std::unique_ptr<Writing> writing{static_cast<Writing *>(context)};
  if (!writing) return;
  try {
    writing->entry->batches[writing->next]->Wipe();
    writing->next++;
    winrt::Windows::Data::Json::JsonObject reply{nullptr};
    if (!json || !winrt::Windows::Data::Json::JsonObject::TryParse(winrt::to_hstring(json), reply)) {
      writing->error = "bad reply from the engine";
    } else if (reply.HasKey(L"error")) {
      writing->error = winrt::to_string(reply.GetNamedString(L"error", L"the engine refused the cookies"));
    } else {
      writing->imported += static_cast<int64_t>(reply.GetNamedNumber(L"imported", 0));
      writing->rejected += static_cast<int64_t>(reply.GetNamedNumber(L"rejected", 0));
      writing->existing += static_cast<int64_t>(reply.GetNamedNumber(L"existing", 0));
    }
  } catch (...) {
    writing->error = "bad reply from the engine";
  }
  auto context = writing->context;
  Writing *raw = writing.release();
  RunOnUI(context, [raw]() noexcept { Step(std::unique_ptr<Writing>{raw}); });
}

inline void Step(std::unique_ptr<Writing> writing) noexcept {
  const ArdiaEngineApi *engine = Host::Engine();
  if (!engine && writing->error.empty()) writing->error = "no engine";
  if (!writing->error.empty() || writing->next >= writing->entry->batches.size()) return Finish(std::move(writing));
  auto &batch = *writing->entry->batches[writing->next];
  std::string profile = writing->profile;
  engine->engineCall("ac_cookies_import", profile.c_str(), reinterpret_cast<const char *>(batch.Data()), &OnBatchReply, writing.release());
}

struct Apartment {
  bool initialized = SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
  ~Apartment() noexcept {
    if (initialized) CoUninitialize();
  }
};

template <class TPromise, class TWork>
void OnAThread(TPromise const &promise, TWork &&work) noexcept {
  try {
    std::thread([work = std::forward<TWork>(work)]() noexcept {
      Apartment apartment;
      work();
    }).detach();
  } catch (...) {
    promise.Reject("the import could not start");
  }
}

}

REACT_MODULE(ImportModule, L"ArdiaWindowsImport")
struct ImportModule {
  using Promise = ImportParts::Promise;
  using MaybeText = ImportParts::MaybeText;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    try {
      std::thread(&ImportParts::RemoveLeftovers).detach();
    } catch (...) {
    }
  }

  REACT_CONSTANT(localAppData)
  const std::string localAppData = ImportParts::Folder(FOLDERID_LocalAppData, L"LOCALAPPDATA", L"Local");

  REACT_CONSTANT(roamingAppData)
  const std::string roamingAppData = ImportParts::Folder(FOLDERID_RoamingAppData, L"APPDATA", L"Roaming");

  REACT_METHOD(list)
  void list(std::string path, Promise promise) noexcept {
    ImportParts::OnAThread(promise, [path, promise]() noexcept {
      try {
        promise.Resolve(ImportFiles::ListJson(std::filesystem::path{Paths::Wide(path)}));
      } catch (...) {
        promise.Reject("the folder could not be listed");
      }
    });
  }

  REACT_METHOD(readText)
  void readText(std::string path, double largest, MaybeText promise) noexcept {
    ImportParts::OnAThread(promise, [path, largest, promise]() noexcept {
      try {
        auto bytes = ImportFiles::ReadBytes(std::filesystem::path{Paths::Wide(path)}, largest > 0 ? static_cast<uint64_t>(largest) : 0);
        promise.Resolve(bytes ? std::optional<std::string>{ImportFiles::TextOf(std::move(*bytes))} : std::nullopt);
      } catch (...) {
        promise.Reject("the file could not be read");
      }
    });
  }

  REACT_METHOD(readBase64)
  void readBase64(std::string path, double largest, MaybeText promise) noexcept {
    ImportParts::OnAThread(promise, [path, largest, promise]() noexcept {
      try {
        auto bytes = ImportFiles::ReadBytes(std::filesystem::path{Paths::Wide(path)}, largest > 0 ? static_cast<uint64_t>(largest) : 0);
        if (!bytes) return promise.Resolve(std::nullopt);
        promise.Resolve(std::optional<std::string>{ImportFiles::Base64(reinterpret_cast<const uint8_t *>(bytes->data()), bytes->size())});
      } catch (...) {
        promise.Reject("the file could not be read");
      }
    });
  }

  REACT_METHOD(query)
  void query(std::string path, winrt::Microsoft::ReactNative::JSValue queries, Promise promise) noexcept {
    auto shared = std::make_shared<winrt::Microsoft::ReactNative::JSValue>(std::move(queries));
    ImportParts::OnAThread(promise, [path, shared, promise]() noexcept {
      try {
        promise.Resolve(ImportFiles::QueryJson(std::filesystem::path{Paths::Wide(path)}, shared->AsArray()));
      } catch (...) {
        promise.Reject("the database could not be read");
      }
    });
  }

  REACT_METHOD(unlock)
  void unlock(std::string browserId, std::string localState, Promise promise) noexcept {
    ImportParts::OnAThread(promise, [browserId, localState, promise]() noexcept {
      try {
        promise.Resolve(ImportSecrets::Unlock(browserId, std::filesystem::path{Paths::Wide(localState)}));
      } catch (...) {
        promise.Reject("the browser's key could not be read");
      }
    });
  }

  REACT_METHOD(logins)
  void logins(std::string browserId, std::vector<std::string> files, Promise promise) noexcept {
    ImportParts::OnAThread(promise, [browserId, files, promise]() noexcept {
      try {
        std::vector<std::filesystem::path> paths;
        for (auto const &file : files) paths.emplace_back(Paths::Wide(file));
        std::string out = ImportSecrets::Logins(browserId, paths);
        promise.Resolve(out);
        SecureZeroMemory(out.data(), out.size());
      } catch (...) {
        promise.Reject("the passwords could not be read");
      }
    });
  }

  REACT_METHOD(cookies)
  void cookies(std::string browserId, std::string file, Promise promise) noexcept {
    ImportParts::OnAThread(promise, [browserId, file, promise]() noexcept {
      try {
        promise.Resolve(ImportSecrets::Cookies(browserId, std::filesystem::path{Paths::Wide(file)}));
      } catch (...) {
        promise.Reject("the cookies could not be read");
      }
    });
  }

  REACT_METHOD(writeCookies)
  void writeCookies(std::string token, std::string profile, Promise promise) noexcept {
    auto entry = ImportSecrets::Store::Shared().Take(token);
    if (!entry) return promise.Reject("Those cookies are no longer kept; import again");
    if (!m_context) return promise.Reject("the import has no app context");
    auto writing = std::make_unique<ImportParts::Writing>(ImportParts::Writing{m_context, entry, profile, 0, 0, 0, 0, {}, promise});
    ImportParts::Writing *raw = writing.release();
    RunOnUI(m_context, [raw]() noexcept { ImportParts::Step(std::unique_ptr<ImportParts::Writing>{raw}); });
  }

  REACT_METHOD(discard)
  void discard(std::string token) noexcept {
    ImportSecrets::Store::Shared().Take(token);
  }

  REACT_METHOD(forget)
  void forget() noexcept {
    ImportSecrets::Store::Shared().Forget();
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
