#pragma once

#include <algorithm>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <wincred.h>

#include "NativeModules.h"

#include "DocumentsModule.h"
#include "Paths.h"

namespace Ardia {

class CredentialStore {
 public:
  static std::optional<std::string> Get(std::string const &account) noexcept {
    std::lock_guard<std::mutex> guard(Lock());
    try {
      std::wstring base = Target(account);
      PCREDENTIALW first = nullptr;
      if (!CredReadW(base.c_str(), CRED_TYPE_GENERIC, 0, &first)) return std::nullopt;
      std::string secret = Blob(first);
      size_t chunks = ChunkCount(first);
      CredFree(first);
      for (size_t index = 1; index < chunks; index++) {
        PCREDENTIALW part = nullptr;
        if (!CredReadW(ChunkTarget(base, index).c_str(), CRED_TYPE_GENERIC, 0, &part)) return std::nullopt;
        secret += Blob(part);
        CredFree(part);
      }
      return secret;
    } catch (...) {
      return std::nullopt;
    }
  }

  static bool Set(std::string const &account, std::string const &secret) noexcept {
    std::lock_guard<std::mutex> guard(Lock());
    try {
      std::wstring base = Target(account);
      std::wstring user = Paths::Wide(account).substr(0, 256);
      size_t previous = ExistingChunks(base);
      size_t chunks = std::max<size_t>(1, (secret.size() + ChunkSize - 1) / ChunkSize);
      if (chunks > MaxChunks) return false;
      for (size_t index = chunks; index-- > 1;) {
        if (!WritePart(ChunkTarget(base, index), user, std::string_view(secret).substr(index * ChunkSize, ChunkSize), L"")) return false;
      }
      std::wstring comment = L"Ardia " + std::to_wstring(chunks);
      if (!WritePart(base, user, std::string_view(secret).substr(0, ChunkSize), comment)) return false;
      for (size_t index = chunks; index < previous; index++) CredDeleteW(ChunkTarget(base, index).c_str(), CRED_TYPE_GENERIC, 0);
      return true;
    } catch (...) {
      return false;
    }
  }

  static bool Delete(std::string const &account) noexcept {
    std::lock_guard<std::mutex> guard(Lock());
    try {
      std::wstring base = Target(account);
      size_t chunks = ExistingChunks(base);
      bool removed = true;
      if (!CredDeleteW(base.c_str(), CRED_TYPE_GENERIC, 0) && GetLastError() != ERROR_NOT_FOUND) removed = false;
      for (size_t index = 1; index < chunks; index++) CredDeleteW(ChunkTarget(base, index).c_str(), CRED_TYPE_GENERIC, 0);
      return removed;
    } catch (...) {
      return false;
    }
  }

 private:
  static constexpr size_t ChunkSize = CRED_MAX_CREDENTIAL_BLOB_SIZE;
  static constexpr size_t MaxChunks = 64;

  static std::mutex &Lock() noexcept {
    static std::mutex *lock = new std::mutex();
    return *lock;
  }

  static std::wstring const &Prefix() noexcept {
    static const std::wstring prefix = [] {
      std::wstring service = L"Ardia Connected Accounts";
      if (!Paths::HasCustomDataDirectory()) return service + L"/";
      std::wstring directory = Paths::DataDirectory().wstring();
      for (auto &c : directory) {
        if (c == L'/') c = L'\\';
      }
      while (directory.size() > 3 && directory.back() == L'\\') directory.pop_back();
      return service + L" [" + directory + L"]/";
    }();
    return prefix;
  }

  static std::wstring Target(std::string const &account) { return Prefix() + Paths::Wide(account); }

  static std::wstring ChunkTarget(std::wstring const &base, size_t index) { return base + L"#" + std::to_wstring(index); }

  static std::string Blob(PCREDENTIALW credential) {
    if (!credential || !credential->CredentialBlob || credential->CredentialBlobSize == 0) return {};
    return std::string(reinterpret_cast<char const *>(credential->CredentialBlob), credential->CredentialBlobSize);
  }

  static size_t ChunkCount(PCREDENTIALW credential) noexcept {
    if (!credential || !credential->Comment) return 1;
    std::wstring_view comment(credential->Comment);
    size_t space = comment.find_last_of(L' ');
    if (space == std::wstring_view::npos) return 1;
    size_t count = 0;
    for (wchar_t c : comment.substr(space + 1)) {
      if (c < L'0' || c > L'9') return 1;
      count = count * 10 + static_cast<size_t>(c - L'0');
      if (count > MaxChunks) return 1;
    }
    return count == 0 ? 1 : count;
  }

  static size_t ExistingChunks(std::wstring const &base) noexcept {
    PCREDENTIALW existing = nullptr;
    if (!CredReadW(base.c_str(), CRED_TYPE_GENERIC, 0, &existing)) return 0;
    size_t count = ChunkCount(existing);
    CredFree(existing);
    return count;
  }

  static bool WritePart(std::wstring const &target, std::wstring const &user, std::string_view bytes, std::wstring const &comment) noexcept {
    CREDENTIALW credential{};
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = const_cast<LPWSTR>(target.c_str());
    credential.UserName = const_cast<LPWSTR>(user.c_str());
    credential.Comment = comment.empty() ? nullptr : const_cast<LPWSTR>(comment.c_str());
    credential.CredentialBlobSize = static_cast<DWORD>(bytes.size());
    credential.CredentialBlob = bytes.empty() ? nullptr : reinterpret_cast<LPBYTE>(const_cast<char *>(bytes.data()));
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    return CredWriteW(&credential, 0) != FALSE;
  }
};

REACT_MODULE(KeychainModule, L"ArdiaKeychain")
struct KeychainModule {
  REACT_METHOD(get)
  void get(std::string account, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    Run([account, promise]() { promise.Resolve(CredentialStore::Get(account)); }, [promise]() { promise.Resolve(std::nullopt); });
  }

  REACT_METHOD(set)
  void set(std::string account, std::string secret, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    Run([account, secret, promise]() { promise.Resolve(CredentialStore::Set(account, secret)); }, [promise]() { promise.Resolve(false); });
  }

  REACT_METHOD(remove, L"delete")
  void remove(std::string account, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    Run([account, promise]() { promise.Resolve(CredentialStore::Delete(account)); }, [promise]() { promise.Resolve(false); });
  }

 private:
  static SerialQueue &Queue() noexcept {
    static SerialQueue *queue = new SerialQueue();
    return *queue;
  }

  template <class TWork, class TFallback>
  static void Run(TWork &&work, TFallback &&fallback) noexcept {
    try {
      Queue().Async(std::forward<TWork>(work));
    } catch (...) {
      fallback();
    }
  }
};

}
