#pragma once

#include <chrono>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <wincred.h>
#include <UserConsentVerifierInterop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>

#include "AppModule.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "SyncCrypto.h"
#include "SyncFiles.h"

#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "credui.lib")

namespace Ardia::SyncSecrets {

using SyncCrypto::WipedBytes;

constexpr std::string_view KeyPurpose = "ardia-sync-key/v1";
constexpr std::string_view TestInstancePurpose = "/test-instance";

inline bool IsAccountName(std::string const &account) noexcept {
  if (account.empty() || account.size() > 64) return false;
  for (char c : account) {
    bool plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!plain) return false;
  }
  return true;
}

inline std::filesystem::path KeyFolder() noexcept { return Paths::DataDirectory() / L"Sync"; }

inline std::filesystem::path KeyPath(std::string const &account) { return KeyFolder() / (L"sync-key-" + Paths::Wide(account) + L".dpapi"); }

inline std::string PurposeFor(std::string const &account, bool testInstance) {
  std::string_view instance = testInstance ? TestInstancePurpose : std::string_view{};
  return std::string{KeyPurpose} + std::string{instance} + "/" + account;
}

inline std::string Purpose(std::string const &account) { return PurposeFor(account, AppLaunch::Shared().testInstance); }

inline bool SaveKey(std::string const &account, WipedBytes const &entropy) noexcept {
  try {
    if (!IsAccountName(account) || entropy.size() != SyncCrypto::KeyBytes) return false;
    std::string purpose = Purpose(account);
    DATA_BLOB plain{static_cast<DWORD>(entropy.size()), const_cast<BYTE *>(entropy.data())};
    DATA_BLOB extra{static_cast<DWORD>(purpose.size()), reinterpret_cast<BYTE *>(purpose.data())};
    DATA_BLOB sealed{};
    if (!CryptProtectData(&plain, L"Ardia sync key", &extra, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &sealed)) return false;
    std::string bytes(reinterpret_cast<char const *>(sealed.pbData), sealed.cbData);
    LocalFree(sealed.pbData);
    std::error_code error;
    std::filesystem::create_directories(KeyFolder(), error);
    SyncFiles::Publish(KeyFolder().wstring(), KeyPath(account).filename().wstring(), bytes, true);
    return true;
  } catch (...) {
    return false;
  }
}

inline std::optional<WipedBytes> Unprotect(std::string &sealedBytes, std::string purpose) noexcept {
  DATA_BLOB sealed{static_cast<DWORD>(sealedBytes.size()), reinterpret_cast<BYTE *>(sealedBytes.data())};
  DATA_BLOB extra{static_cast<DWORD>(purpose.size()), reinterpret_cast<BYTE *>(purpose.data())};
  DATA_BLOB plain{};
  if (!CryptUnprotectData(&sealed, nullptr, &extra, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &plain)) return std::nullopt;
  WipedBytes entropy(plain.pbData, plain.cbData);
  SecureZeroMemory(plain.pbData, plain.cbData);
  LocalFree(plain.pbData);
  if (entropy.size() != SyncCrypto::KeyBytes) return std::nullopt;
  return std::move(entropy);
}

inline std::optional<std::string> StoredKey(std::string const &account) noexcept {
  try {
    if (!IsAccountName(account)) return std::nullopt;
    SyncFiles::Read stored = SyncFiles::ReadFile(KeyPath(account).wstring());
    if (stored.state != SyncFiles::Read::State::Data) return std::nullopt;
    return std::move(stored.bytes);
  } catch (...) {
    return std::nullopt;
  }
}

inline std::optional<WipedBytes> LoadKey(std::string const &account) noexcept {
  std::optional<std::string> stored = StoredKey(account);
  if (!stored) return std::nullopt;
  return Unprotect(*stored, Purpose(account));
}

inline void DeleteKey(std::string const &account) noexcept {
  try {
    if (IsAccountName(account)) DeleteFileW(KeyPath(account).c_str());
  } catch (...) {
  }
}

inline bool ProtectedStorageRoundTrip() noexcept {
  WipedBytes probe(SyncCrypto::KeyBytes);
  if (!SyncCrypto::RandomBytes(probe.data(), probe.size())) return false;
  std::string account = "self-check-" + SyncCrypto::Base32(probe.data(), 5);
  bool saved = SaveKey(account, probe);
  std::optional<WipedBytes> loaded = saved ? LoadKey(account) : std::nullopt;
  bool same = loaded && loaded->view() == probe.view();
  std::optional<std::string> stored = StoredKey(account);
  bool hidden = stored && stored->find(probe.view()) == std::string::npos;
  bool boundToPurpose = stored && !Unprotect(*stored, Purpose(account + "-other"));
  bool apartFromOtherInstances = stored && !Unprotect(*stored, PurposeFor(account, !AppLaunch::Shared().testInstance));
  DeleteKey(account);
  std::error_code error;
  return saved && same && hidden && boundToPurpose && apartFromOtherInstances && !std::filesystem::exists(KeyPath(account), error);
}

namespace OwnerParts {

using winrt::Windows::Security::Credentials::UI::UserConsentVerificationResult;
using winrt::Windows::Security::Credentials::UI::UserConsentVerifier;
using winrt::Windows::Security::Credentials::UI::UserConsentVerifierAvailability;

inline bool HelloAvailable() noexcept {
  try {
    return UserConsentVerifier::CheckAvailabilityAsync().get() == UserConsentVerifierAvailability::Available;
  } catch (...) {
    return false;
  }
}

inline std::optional<bool> AskHello(HWND owner, std::wstring const &message) noexcept {
  try {
    auto interop = winrt::get_activation_factory<UserConsentVerifier, IUserConsentVerifierInterop>();
    winrt::Windows::Foundation::IAsyncOperation<UserConsentVerificationResult> operation{nullptr};
    winrt::hstring text{message};
    winrt::check_hresult(interop->RequestVerificationForWindowAsync(owner, static_cast<HSTRING>(winrt::get_abi(text)), winrt::guid_of<decltype(operation)>(), winrt::put_abi(operation)));
    UserConsentVerificationResult result = operation.get();
    if (result == UserConsentVerificationResult::Verified) return true;
    if (result == UserConsentVerificationResult::Canceled || result == UserConsentVerificationResult::RetriesExhausted) return false;
    return std::nullopt;
  } catch (...) {
    return std::nullopt;
  }
}

inline std::vector<BYTE> UserSid(HANDLE token) noexcept {
  DWORD size = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &size);
  std::vector<BYTE> buffer(size);
  if (!size || !GetTokenInformation(token, TokenUser, buffer.data(), size, &size)) return {};
  PSID sid = reinterpret_cast<TOKEN_USER *>(buffer.data())->User.Sid;
  if (!IsValidSid(sid)) return {};
  BYTE const *start = static_cast<BYTE const *>(sid);
  return std::vector<BYTE>(start, start + GetLengthSid(sid));
}

inline bool IsCurrentUser(HANDLE token) noexcept {
  HANDLE own = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &own)) return false;
  std::vector<BYTE> mine = UserSid(own);
  CloseHandle(own);
  std::vector<BYTE> theirs = UserSid(token);
  return !mine.empty() && mine == theirs;
}

inline bool AskPassword(HWND owner, std::wstring const &message) noexcept {
  CREDUI_INFOW info{};
  info.cbSize = sizeof(info);
  info.hwndParent = owner;
  info.pszCaptionText = L"Ardia";
  info.pszMessageText = message.c_str();
  ULONG package = 0;
  LPVOID answer = nullptr;
  ULONG answerSize = 0;
  BOOL save = FALSE;
  DWORD shown = CredUIPromptForWindowsCredentialsW(&info, 0, &package, nullptr, 0, &answer, &answerSize, &save, CREDUIWIN_ENUMERATE_CURRENT_USER);
  if (shown != ERROR_SUCCESS || !answer) return false;
  wchar_t name[CREDUI_MAX_USERNAME_LENGTH + 1]{};
  wchar_t domain[CREDUI_MAX_DOMAIN_TARGET_LENGTH + 1]{};
  wchar_t password[CREDUI_MAX_PASSWORD_LENGTH + 1]{};
  DWORD nameSize = CREDUI_MAX_USERNAME_LENGTH, domainSize = CREDUI_MAX_DOMAIN_TARGET_LENGTH, passwordSize = CREDUI_MAX_PASSWORD_LENGTH;
  bool unpacked = CredUnPackAuthenticationBufferW(CRED_PACK_PROTECTED_CREDENTIALS, answer, answerSize, name, &nameSize, domain, &domainSize, password, &passwordSize);
  SecureZeroMemory(answer, answerSize);
  CoTaskMemFree(answer);
  bool granted = false;
  if (unpacked) {
    wchar_t account[CREDUI_MAX_USERNAME_LENGTH + 1]{};
    wchar_t accountDomain[CREDUI_MAX_DOMAIN_TARGET_LENGTH + 1]{};
    bool parsed = CredUIParseUserNameW(name, account, CREDUI_MAX_USERNAME_LENGTH, accountDomain, CREDUI_MAX_DOMAIN_TARGET_LENGTH) == NO_ERROR;
    HANDLE token = nullptr;
    if (LogonUserW(parsed ? account : name, parsed ? accountDomain : (domain[0] ? domain : nullptr), password, LOGON32_LOGON_INTERACTIVE, LOGON32_PROVIDER_DEFAULT, &token)) {
      granted = IsCurrentUser(token);
      CloseHandle(token);
    }
  }
  SecureZeroMemory(password, sizeof(password));
  return granted;
}

}

class OwnerCheck {
 public:
  using Done = std::function<void(bool)>;

  void Revoke() noexcept {
    std::lock_guard<std::mutex> guard(m_lock);
    m_grantedAt.reset();
  }

  void Confirm(HWND owner, std::wstring reason, Done done) {
    bool recent = false;
    bool first = false;
    {
      std::lock_guard<std::mutex> guard(m_lock);
      recent = m_grantedAt && std::chrono::steady_clock::now() - *m_grantedAt < Validity;
      if (!recent) {
        m_waiting.push_back(std::move(done));
        first = m_waiting.size() == 1;
      }
    }
    if (recent) return done(true);
    if (!first) return;
    std::thread([this, owner, reason = std::move(reason)]() noexcept {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
      bool granted = Evaluate(owner, reason);
      std::vector<Done> everyone;
      {
        std::lock_guard<std::mutex> guard(m_lock);
        if (granted) m_grantedAt = std::chrono::steady_clock::now();
        everyone.swap(m_waiting);
      }
      for (Done &waiter : everyone) waiter(granted);
      winrt::uninit_apartment();
    }).detach();
  }

 private:
  static constexpr std::chrono::seconds Validity{60};

  static bool Evaluate(HWND owner, std::wstring const &reason) noexcept {
    AppLaunch::Config const &config = AppLaunch::Shared();
    if (config.background) {
      auto answer = config.test.find("reauth");
      bool granted = config.testInstance && answer != config.test.end() && answer->second == "granted";
      LaunchLog::Write(L"sync", std::wstring{L"device owner check in a hidden test instance, no prompt: "} + (granted ? L"granted" : L"denied"));
      return granted;
    }
    std::wstring message = L"Ardia wants to " + reason + L".";
    if (OwnerParts::HelloAvailable()) {
      if (std::optional<bool> answer = OwnerParts::AskHello(owner, message)) return *answer;
    }
    return OwnerParts::AskPassword(owner, message);
  }

  std::mutex m_lock;
  std::optional<std::chrono::steady_clock::time_point> m_grantedAt;
  std::vector<Done> m_waiting;
};

}
