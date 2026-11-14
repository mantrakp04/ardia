#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "NativeModules.h"

#include "AppModule.h"
#include "DocumentsModule.h"
#include "Events.h"
#include "LaunchLog.h"
#include "SyncSelfTest.h"
#include "SyncSystem.h"
#include "SyncVault.h"
#include "WindowManager.h"

namespace Ardia {

namespace SyncModuleParts {

using winrt::Microsoft::ReactNative::JSValue;
using winrt::Microsoft::ReactNative::JSValueObject;
using winrt::Microsoft::ReactNative::ReactPromise;

inline SerialQueue &Work() noexcept {
  static SerialQueue *queue = new SerialQueue();
  return *queue;
}

inline SyncVault::State &Shared() noexcept {
  static SyncVault::State *state = new SyncVault::State();
  return *state;
}

inline SyncSecrets::OwnerCheck &Owner() noexcept {
  static SyncSecrets::OwnerCheck *owner = new SyncSecrets::OwnerCheck();
  return *owner;
}

template <class TValue, class TWork>
void OnQueue(ReactPromise<TValue> const &promise, TWork &&work) noexcept {
  bool queued = Work().Async([promise, work = std::forward<TWork>(work)]() {
    try {
      work();
    } catch (SyncFiles::Failure const &failure) {
      promise.Reject(failure.message.c_str());
    } catch (...) {
      promise.Reject("sync failed");
    }
  });
  if (!queued) promise.Reject("sync is busy");
}

inline std::string TestFolder() noexcept {
  AppLaunch::Config const &config = AppLaunch::Shared();
  auto found = config.instance.find("syncFolder");
  return config.testInstance && found != config.instance.end() ? found->second : std::string{};
}

inline void RemoveTemporaryKits() noexcept {
  try {
    std::wstring folder = SyncSystem::KitFolder();
    if (SyncFiles::IsDirectory(folder)) SyncFiles::RemoveTree(folder);
  } catch (...) {
  }
}

}

REACT_MODULE(SyncModule, L"ArdiaWindowsSync")
struct SyncModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    SyncModuleParts::Work().Async([]() { SyncModuleParts::RemoveTemporaryKits(); });
  }

  REACT_CONSTANT(computerName)
  const std::string computerName = SyncSystem::ComputerName();

  REACT_CONSTANT(oneDriveFolder)
  const std::string oneDriveFolder = SyncSystem::OneDriveFolder();

  REACT_CONSTANT(documentsFolder)
  const std::string documentsFolder = SyncSystem::DocumentsFolder();

  REACT_CONSTANT(testFolder)
  const std::string testFolder = SyncModuleParts::TestFolder();

  REACT_METHOD(createKey)
  void createKey(std::string account, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [account, promise]() {
      bool created = SyncVault::CreateKey(SyncModuleParts::Shared(), account);
      if (created) SyncModuleParts::Owner().Revoke();
      promise.Resolve(created);
    });
  }

  REACT_METHOD(enterPhrase)
  void enterPhrase(std::string account, std::string text, std::string folder, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    auto phrase = std::make_shared<SyncCrypto::WipedString>(std::move(text));
    SyncModuleParts::OnQueue(promise, [account, phrase, folder, promise]() {
      SyncVault::PhraseAnswer answer = SyncVault::EnterPhrase(SyncModuleParts::Shared(), account, phrase->text(), folder);
      phrase->text().clear();
      winrt::Microsoft::ReactNative::JSValueObject result;
      if (answer.error.empty()) {
        SyncModuleParts::Owner().Revoke();
        result["ok"] = true;
      } else {
        result["error"] = answer.error;
        if (answer.error == "wordCount") result["count"] = static_cast<int64_t>(answer.count);
        if (answer.error == "unknownWord") result["word"] = answer.word;
      }
      promise.Resolve(winrt::Microsoft::ReactNative::JSValue{std::move(result)});
    });
  }

  REACT_METHOD(unlock)
  void unlock(std::string account, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [account, promise]() { promise.Resolve(SyncVault::Unlock(SyncModuleParts::Shared(), account)); });
  }

  REACT_METHOD(forget)
  void forget(std::string account, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [account, promise]() {
      SyncSecrets::DeleteKey(account);
      SyncModuleParts::Shared().Clear();
      SyncModuleParts::Owner().Revoke();
      promise.Resolve(true);
    });
  }

  REACT_METHOD(chainStatus)
  void chainStatus(std::string folder, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, promise]() { promise.Resolve(SyncVault::ChainStatus(folder, *SyncModuleParts::Shared().Unlocked().keys)); });
  }

  REACT_METHOD(createChain)
  void createChain(std::string folder, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, promise]() {
      SyncVault::CreateChain(folder, *SyncModuleParts::Shared().Unlocked().keys);
      promise.Resolve(true);
    });
  }

  REACT_METHOD(deleteChain)
  void deleteChain(std::string folder, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, promise]() {
      SyncVault::DeleteChain(folder, *SyncModuleParts::Shared().Unlocked().keys);
      promise.Resolve(true);
    });
  }

  REACT_METHOD(list)
  void list(std::string folder, std::string scope, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, scope, promise]() { promise.Resolve(SyncVault::List(folder, *SyncModuleParts::Shared().Unlocked().keys, scope)); });
  }

  REACT_METHOD(open)
  void open(std::string folder, std::string scope, std::string id, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, scope, id, promise]() {
      SyncVault::Session session = SyncModuleParts::Shared().Unlocked();
      SyncVault::Opened opened = SyncVault::Open(folder, *session.keys, scope, id);
      if (!SyncModuleParts::Shared().Still(session.generation)) return promise.Reject(SyncVault::Locked);
      winrt::Microsoft::ReactNative::JSValueObject result;
      result["state"] = opened.state;
      if (opened.state == "data") result["payload"] = std::move(opened.payload);
      promise.Resolve(winrt::Microsoft::ReactNative::JSValue{std::move(result)});
    });
  }

  REACT_METHOD(write)
  void write(std::string folder, std::string scope, std::string payload, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, scope, payload, promise]() {
      SyncVault::Session session = SyncModuleParts::Shared().Unlocked();
      if (session.localUnreadable) return promise.Reject(SyncVault::Unreadable);
      uint64_t generation = session.generation;
      promise.Resolve(SyncVault::Write(folder, *session.keys, scope, payload, [generation]() { return SyncModuleParts::Shared().Still(generation); }));
    });
  }

  REACT_METHOD(remove)
  void remove(std::string folder, std::string scope, std::string id, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [folder, scope, id, promise]() { promise.Resolve(SyncVault::Remove(folder, *SyncModuleParts::Shared().Unlocked().keys, scope, id)); });
  }

  REACT_METHOD(hydrate)
  void hydrate(std::string folder, std::string scope, std::string id) noexcept {
    SyncModuleParts::Work().Async([folder, scope, id]() {
      try {
        SyncVault::Session session = SyncModuleParts::Shared().Current();
        if (session.keys) SyncVault::Hydrate(folder, *session.keys, scope, id);
      } catch (...) {
      }
    });
  }

  REACT_SYNC_METHOD(takeHydrated)
  int takeHydrated() noexcept {
    return static_cast<int>(SyncFiles::Hydrator::Shared().TakeHydrated());
  }

  REACT_METHOD(sealLocal)
  void sealLocal(std::string text, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [text, promise]() {
      SyncVault::Session session = SyncModuleParts::Shared().Unlocked();
      if (session.localUnreadable) return promise.Reject(SyncVault::Unreadable);
      std::optional<std::string> sealed = session.keys->Seal(text, "local", "state");
      if (!sealed) return promise.Reject("the sync state couldn't be sealed");
      promise.Resolve(SyncCrypto::Base64(*sealed));
    });
  }

  REACT_METHOD(openLocal)
  void openLocal(std::string sealed, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [sealed, promise]() {
      SyncVault::Session session = SyncModuleParts::Shared().Current();
      std::optional<SyncCrypto::WipedBytes> data = session.keys ? SyncCrypto::FromBase64(sealed) : std::nullopt;
      if (!data) return promise.Resolve(std::nullopt);
      SyncVault::Opened opened = SyncVault::OpenSealed(*session.keys, "local", "state", data->view());
      if (opened.state == "unreadable") SyncModuleParts::Shared().MarkLocalUnreadable(session.generation);
      if (opened.state != "data") return promise.Resolve(std::nullopt);
      promise.Resolve(std::optional<std::string>{std::move(opened.payload)});
    });
  }

  REACT_METHOD(recoveryWords)
  void recoveryWords(winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::vector<std::string>>> promise) noexcept {
    Disclose(promise, L"show your sync recovery phrase", [promise](std::vector<std::string> words) { promise.Resolve(std::move(words)); });
  }

  REACT_METHOD(copyRecoveryPhrase)
  void copyRecoveryPhrase(winrt::Microsoft::ReactNative::ReactPromise<std::optional<bool>> promise) noexcept {
    auto context = m_context;
    Disclose(promise, L"copy your sync recovery phrase", [promise, context](std::vector<std::string> words) {
      auto joined = std::make_shared<SyncCrypto::WipedString>();
      for (std::string &word : words) joined->text() += (joined->text().empty() ? "" : " ") + word;
      RunOnUI(context, [promise, joined]() noexcept { promise.Resolve(SyncSystem::CopyConcealedText(WindowManager::Shared().ActiveHwnd(), joined->text())); });
    });
  }

  REACT_METHOD(folderState)
  void folderState(std::string path, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    std::thread([path, promise]() noexcept {
      std::wstring folder = Paths::Wide(path);
      bool exists = SyncFiles::IsDirectory(folder);
      HANDLE probe = exists ? CreateFileW(folder.c_str(), FILE_ADD_FILE, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr)
                            : INVALID_HANDLE_VALUE;
      bool writable = probe != INVALID_HANDLE_VALUE;
      if (writable) CloseHandle(probe);
      winrt::Microsoft::ReactNative::JSValueObject state;
      state["exists"] = exists;
      state["writable"] = writable;
      state["hasSyncData"] = exists && SyncFiles::HasTagFolder(folder);
      promise.Resolve(winrt::Microsoft::ReactNative::JSValue{std::move(state)});
    }).detach();
  }

  REACT_METHOD(readPasswords)
  void readPasswords(std::string profile, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    SyncVault::Session session = SyncModuleParts::Shared().Current();
    if (!session.keys) return promise.Resolve(std::nullopt);
    SyncSystem::CallEngine(m_context, "ac_passwords_logins", profile, std::make_shared<SyncCrypto::WipedString>(std::string{"{}"}), [session, promise](std::shared_ptr<SyncCrypto::WipedString> reply) {
      bool queued = SyncModuleParts::Work().Async([session, promise, reply]() {
        std::optional<std::string> sealed = reply ? SyncLogins::SealedLogins(reply->text(), *session.keys) : std::nullopt;
        std::string problem = sealed ? std::string{} : reply ? SyncSystem::ReplyError(reply) : std::string{"no reply"};
        if (reply) SyncCrypto::WipeString(reply->text());
        if (!SyncModuleParts::Shared().Still(session.generation)) return promise.Resolve(std::nullopt);
        if (!sealed) LaunchLog::Write(L"sync", L"reading passwords: " + Paths::Wide(problem));
        promise.Resolve(sealed);
      });
      if (!queued) promise.Resolve(std::nullopt);
    });
  }

  REACT_METHOD(savePassword)
  void savePassword(std::string profile, std::string origin, std::string username, std::string sealed, bool replacing, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    auto context = m_context;
    SyncModuleParts::OnQueue(promise, [context, profile, origin, username, sealed, replacing, promise]() {
      SyncVault::Session session = SyncModuleParts::Shared().Current();
      std::optional<SyncCrypto::WipedBytes> opened = session.keys ? session.keys->OpenPassword(sealed, origin, username) : std::nullopt;
      if (!opened) {
        LaunchLog::Write(L"sync", L"a synced password didn't open for its login; not saving it");
        return promise.Resolve(false);
      }
      auto password = std::make_shared<SyncCrypto::WipedString>(std::string{opened->view()});
      uint64_t generation = session.generation;
      auto still = [generation]() { return SyncModuleParts::Shared().Still(generation); };
      auto done = [promise, still](bool saved) { promise.Resolve(saved && still()); };
      if (replacing) SyncSystem::ReplacePassword(context, profile, origin, username, password, still, done);
      else SyncSystem::AddPassword(context, profile, origin, username, password, still, done);
    });
  }

  REACT_METHOD(saveFile)
  void saveFile(std::string path, std::string base64, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    SyncModuleParts::OnQueue(promise, [path, base64, promise]() {
      std::filesystem::path target{Paths::Wide(path)};
      std::optional<SyncCrypto::WipedBytes> bytes = SyncCrypto::FromBase64(base64);
      if (!bytes || !target.is_absolute() || !target.has_filename()) return promise.Resolve(false);
      SyncFiles::Publish(target.parent_path().wstring(), target.filename().wstring(), bytes->view(), true);
      promise.Resolve(true);
    });
  }

  REACT_METHOD(copyKitFile)
  void copyKitFile(std::string name, std::string base64, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    auto context = m_context;
    SyncModuleParts::OnQueue(promise, [context, name, base64, promise]() {
      std::wstring wideName = Paths::Wide(name);
      std::optional<SyncCrypto::WipedBytes> bytes = SyncCrypto::FromBase64(base64);
      if (!bytes || wideName.empty() || wideName.find_first_of(L"\\/:*?\"<>|") != std::wstring::npos) return promise.Resolve(false);
      std::wstring folder = SyncSystem::KitFolder();
      SyncFiles::MakeDirectory(folder);
      SyncFiles::Publish(folder, wideName, bytes->view(), true);
      std::wstring path = folder + L"\\" + wideName;
      RunOnUI(context, [promise, path]() noexcept { promise.Resolve(SyncSystem::CopyFileItem(WindowManager::Shared().ActiveHwnd(), path)); });
    });
  }

  REACT_METHOD(renderPdf)
  void renderPdf(std::string base64, double width, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    std::thread([base64, width, promise]() noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      std::optional<SyncCrypto::WipedBytes> pdf = SyncCrypto::FromBase64(base64);
      promise.Resolve(pdf ? SyncSystem::RenderPdfPage(pdf->view(), width, 2) : std::nullopt);
      winrt::uninit_apartment();
    }).detach();
  }

  REACT_METHOD(selfTest)
  void selfTest(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    if (!AppLaunch::Shared().testInstance) return promise.Reject("checks are for test instances only");
    SyncModuleParts::OnQueue(promise, [promise]() { promise.Resolve(SyncSelfTest::Primitives()); });
  }

  REACT_METHOD(checkFiles)
  void checkFiles(std::string folder, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    if (!AppLaunch::Shared().testInstance) return promise.Reject("checks are for test instances only");
    SyncModuleParts::OnQueue(promise, [folder, promise]() { promise.Resolve(SyncSelfTest::FileSteps(folder)); });
  }

  REACT_METHOD(checkWith)
  void checkWith(std::string entropyHex, std::string action, std::string first, std::string second, std::string third,
                 winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    if (!AppLaunch::Shared().testInstance) return promise.Reject("checks are for test instances only");
    SyncModuleParts::OnQueue(promise, [entropyHex, action, first, second, third, promise]() { promise.Resolve(SyncSelfTest::With(entropyHex, action, first, second, third)); });
  }

 private:
  template <class TValue, class TReveal>
  void Disclose(winrt::Microsoft::ReactNative::ReactPromise<std::optional<TValue>> const &promise, std::wstring reason, TReveal &&reveal) noexcept {
    SyncVault::Session session = SyncModuleParts::Shared().Current();
    if (!session.keys) return promise.Reject("Sync isn't set up on this PC.");
    uint64_t generation = session.generation;
    RunOnUI(m_context, [promise, reason, generation, reveal = std::forward<TReveal>(reveal)]() noexcept {
      HWND owner = WindowManager::Shared().ActiveHwnd();
      SyncModuleParts::Owner().Confirm(owner, reason, [promise, generation, reveal](bool granted) {
        if (!granted) return promise.Resolve(std::nullopt);
        bool queued = SyncModuleParts::Work().Async([promise, generation, reveal]() {
          std::optional<std::vector<std::string>> words = SyncVault::Words(SyncModuleParts::Shared(), generation);
          if (!words) return promise.Resolve(std::nullopt);
          reveal(std::move(*words));
        });
        if (!queued) promise.Resolve(std::nullopt);
      });
    });
  }

  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
