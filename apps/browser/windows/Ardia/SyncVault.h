#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>

#include "Paths.h"
#include "SyncCrypto.h"
#include "SyncFiles.h"
#include "SyncHandles.h"
#include "SyncLogins.h"
#include "SyncPhrase.h"
#include "SyncSecrets.h"

namespace Ardia::SyncVault {

using SyncCrypto::Keys;
using SyncCrypto::WipedBytes;
using SyncCrypto::WipedString;
using Failure = SyncFiles::Failure;

constexpr char Locked[] = "locked";
constexpr char Unreadable[] = "unreadable";

struct Session {
  std::string account;
  std::shared_ptr<Keys const> keys;
  uint64_t generation = 0;
  bool localUnreadable = false;
};

class State {
 public:
  Session Current() {
    std::lock_guard<std::mutex> guard(m_lock);
    return m_session;
  }

  Session Unlocked() {
    Session session = Current();
    if (!session.keys) throw Failure(Locked);
    return session;
  }

  void Set(std::string account, std::shared_ptr<Keys const> keys) {
    std::lock_guard<std::mutex> guard(m_lock);
    m_session = Session{std::move(account), std::move(keys), ++m_generation, false};
  }

  void Clear() {
    std::lock_guard<std::mutex> guard(m_lock);
    m_session = Session{{}, nullptr, ++m_generation, false};
  }

  bool Still(uint64_t generation) {
    std::lock_guard<std::mutex> guard(m_lock);
    return m_session.keys && m_session.generation == generation;
  }

  void MarkLocalUnreadable(uint64_t generation) {
    std::lock_guard<std::mutex> guard(m_lock);
    if (m_session.generation == generation) m_session.localUnreadable = true;
  }

 private:
  std::mutex m_lock;
  Session m_session;
  uint64_t m_generation = 0;
};

inline std::shared_ptr<Keys const> KeysFrom(WipedBytes const &entropy) {
  std::optional<Keys> keys = Keys::Derive(entropy.view());
  if (!keys) return nullptr;
  return std::make_shared<Keys const>(std::move(*keys));
}

inline std::wstring Folder(std::string const &folder) {
  std::wstring wide = Paths::Wide(folder);
  while (wide.size() > 3 && (wide.back() == L'\\' || wide.back() == L'/')) wide.pop_back();
  if (!SyncFiles::IsUsableFolder(wide)) throw Failure("not a sync folder path");
  return wide;
}

inline std::wstring ChainPath(std::string const &folder, Keys const &keys) { return Folder(folder) + L"\\" + Paths::Wide(keys.ChainTag()); }

inline std::wstring ScopePath(std::string const &folder, Keys const &keys, std::string const &scope) {
  std::optional<std::string> tag = keys.ScopeTag(scope);
  if (!tag) throw Failure("no scope tag");
  return ChainPath(folder, keys) + L"\\" + Paths::Wide(*tag);
}

inline std::wstring FilePath(std::wstring const &scopePath, std::string const &id) {
  if (!SyncCrypto::IsTag(id)) throw Failure("not a sync file id");
  return scopePath + L"\\" + Paths::Wide(id) + std::wstring{SyncFiles::VaultExtension};
}

inline std::wstring Name(std::string const &tag) { return Paths::Wide(tag); }

inline SyncHandles::Handle RootOf(std::string const &folder) {
  SyncHandles::OpenedFolder root = SyncHandles::OpenRoot(Folder(folder));
  if (root.state != SyncHandles::Folder::Directory) throw Failure("the sync folder isn't reachable");
  return std::move(root.handle);
}

inline std::string ChainStatus(std::string const &folder, Keys const &keys) {
  SyncHandles::OpenedFolder root = SyncHandles::OpenRoot(Folder(folder));
  if (root.state != SyncHandles::Folder::Directory) return "unavailable";
  switch (SyncHandles::OpenFolderAt(root.handle.get(), Name(keys.ChainTag()), false).state) {
    case SyncHandles::Folder::Directory: return "ok";
    case SyncHandles::Folder::Absent: return "missing";
    default: return "unavailable";
  }
}

inline void CreateChain(std::string const &folder, Keys const &keys) {
  std::wstring root = Folder(folder);
  if (!SyncFiles::IsDirectory(root)) {
    int created = SHCreateDirectoryExW(nullptr, root.c_str(), nullptr);
    if (created != ERROR_SUCCESS && created != ERROR_ALREADY_EXISTS) throw Failure(SyncFiles::Problem("the sync folder couldn't be created", static_cast<DWORD>(created)));
  }
  SyncHandles::OpenedFolder chain = SyncHandles::OpenFolderAt(RootOf(folder).get(), Name(keys.ChainTag()), true);
  if (chain.state == SyncHandles::Folder::Link) throw Failure("the sync folder holds a link where sync data belongs");
  if (chain.state != SyncHandles::Folder::Directory) throw Failure("the sync data couldn't be created");
}

inline void DeleteChain(std::string const &folder, Keys const &keys) {
  if (!SyncHandles::RemoveFolderAt(RootOf(folder).get(), Name(keys.ChainTag()))) throw Failure("the sync data couldn't be deleted");
}

inline std::optional<SyncHandles::Handle> ScopeOf(std::string const &folder, Keys const &keys, std::string const &scope, bool create) {
  SyncHandles::Handle root = RootOf(folder);
  SyncHandles::OpenedFolder chain = SyncHandles::OpenFolderAt(root.get(), Name(keys.ChainTag()), false);
  if (chain.state == SyncHandles::Folder::Link) throw Failure("the sync folder holds a link where sync data belongs");
  if (chain.state != SyncHandles::Folder::Directory) throw Failure("the sync folder isn't reachable");
  std::optional<std::string> tag = keys.ScopeTag(scope);
  if (!tag) throw Failure("no scope tag");
  SyncHandles::OpenedFolder held = SyncHandles::OpenFolderAt(chain.handle.get(), Name(*tag), create);
  if (held.state == SyncHandles::Folder::Absent && !create) return std::nullopt;
  if (held.state == SyncHandles::Folder::Link) throw Failure("the sync folder holds a link where sync data belongs");
  if (held.state != SyncHandles::Folder::Directory) throw Failure("the sync folder isn't reachable");
  return std::move(held.handle);
}

inline std::wstring FileName(std::string const &id) {
  if (!SyncCrypto::IsTag(id)) throw Failure("not a sync file id");
  return Paths::Wide(id) + std::wstring{SyncFiles::VaultExtension};
}

inline std::optional<std::string> List(std::string const &folder, Keys const &keys, std::string const &scope) {
  std::optional<SyncHandles::Handle> held = ScopeOf(folder, keys, scope, false);
  if (!held) return std::nullopt;
  return SyncHandles::ListJson(held->get());
}

struct Opened {
  std::string state;
  std::string payload;
};

inline std::string ValidUtf8(std::string text) {
  if (SyncCrypto::IsUtf8(text)) return text;
  return Paths::Utf8(Paths::Wide(text));
}

inline Opened OpenSealed(Keys const &keys, std::string const &scopeTag, std::string const &id, std::string_view file) {
  std::optional<WipedBytes> plain = keys.Open(file, scopeTag, id);
  if (!plain) return Opened{"damaged", {}};
  std::optional<std::string> hidden = SyncLogins::Hide(plain->view(), keys);
  if (!hidden) return Opened{"unreadable", {}};
  return Opened{"data", ValidUtf8(std::move(*hidden))};
}

inline Opened Open(std::string const &folder, Keys const &keys, std::string const &scope, std::string const &id) {
  std::optional<SyncHandles::Handle> held = ScopeOf(folder, keys, scope, false);
  if (!held) return Opened{"missing", {}};
  SyncFiles::Read read = SyncHandles::ReadAt(held->get(), FileName(id));
  switch (read.state) {
    case SyncFiles::Read::State::Busy: return Opened{"busy", {}};
    case SyncFiles::Read::State::Placeholder: return Opened{"placeholder", {}};
    case SyncFiles::Read::State::Missing: return Opened{"missing", {}};
    case SyncFiles::Read::State::Data: break;
  }
  return OpenSealed(keys, *keys.ScopeTag(scope), id, read.bytes);
}

inline std::string NewFileId() {
  uint8_t random[16]{};
  if (!SyncCrypto::RandomBytes(random, sizeof(random))) throw Failure("no random bytes for a file id");
  return SyncCrypto::Base32(random, sizeof(random));
}

inline std::string SealForVault(Keys const &keys, std::string const &scopeTag, std::string const &id, std::string_view payload) {
  std::optional<WipedString> restored = SyncLogins::Restore(payload, keys);
  if (!restored) throw Failure("a synced password in this document couldn't be opened");
  std::optional<std::string> sealed = keys.Seal(restored->text(), scopeTag, id);
  if (!sealed) throw Failure("the document couldn't be sealed");
  return std::move(*sealed);
}

template <class TStill>
std::string Write(std::string const &folder, Keys const &keys, std::string const &scope, std::string_view payload, TStill &&still) {
  std::optional<SyncHandles::Handle> held = ScopeOf(folder, keys, scope, true);
  if (!held) throw Failure("the sync folder isn't reachable");
  std::string id = NewFileId();
  std::string sealed = SealForVault(keys, *keys.ScopeTag(scope), id, payload);
  if (!still()) throw Failure(Locked);
  SyncHandles::PublishAt(held->get(), FileName(id), sealed);
  return id;
}

inline std::string Remove(std::string const &folder, Keys const &keys, std::string const &scope, std::string const &id) {
  std::optional<SyncHandles::Handle> held = ScopeOf(folder, keys, scope, false);
  if (!held) return "missing";
  return SyncHandles::RemoveAt(held->get(), FileName(id));
}

inline void Hydrate(std::string const &folder, Keys const &keys, std::string const &scope, std::string const &id) {
  std::wstring scopePath = ScopePath(folder, keys, scope);
  if (SyncFiles::ProbePath(scopePath) != SyncFiles::Probe::Directory) return;
  SyncFiles::Hydrator::Shared().Request(FilePath(scopePath, id));
}

struct PhraseAnswer {
  std::string error;
  size_t count = 0;
  std::string word;
};

inline PhraseAnswer EnterPhrase(State &state, std::string const &account, std::string_view text, std::string const &folder) {
  std::variant<WipedBytes, SyncPhrase::Problem> parsed = SyncPhrase::Entropy(text);
  if (auto *problem = std::get_if<SyncPhrase::Problem>(&parsed)) return PhraseAnswer{problem->error, problem->count, problem->word};
  WipedBytes const &entropy = std::get<WipedBytes>(parsed);
  std::shared_ptr<Keys const> keys = KeysFrom(entropy);
  if (!keys) return PhraseAnswer{"keychain"};
  std::wstring root = Folder(folder);
  SyncFiles::Probe chain = SyncFiles::ProbePath(ChainPath(folder, *keys));
  if (chain != SyncFiles::Probe::Directory) return PhraseAnswer{chain == SyncFiles::Probe::Absent && SyncFiles::HasTagFolder(root) ? "mismatch" : "noData"};
  if (!SyncSecrets::SaveKey(account, entropy)) return PhraseAnswer{"keychain"};
  state.Set(account, keys);
  return PhraseAnswer{};
}

inline bool CreateKey(State &state, std::string const &account) {
  WipedBytes entropy(SyncCrypto::KeyBytes);
  if (!SyncCrypto::RandomBytes(entropy.data(), entropy.size())) return false;
  std::shared_ptr<Keys const> keys = KeysFrom(entropy);
  if (!keys || !SyncSecrets::SaveKey(account, entropy)) return false;
  state.Set(account, keys);
  return true;
}

inline bool Unlock(State &state, std::string const &account) {
  std::optional<WipedBytes> entropy = SyncSecrets::LoadKey(account);
  if (!entropy) return false;
  std::shared_ptr<Keys const> keys = KeysFrom(*entropy);
  if (!keys) return false;
  state.Set(account, keys);
  return true;
}

inline std::optional<std::vector<std::string>> Words(State &state, uint64_t generation) {
  Session session = state.Current();
  if (!session.keys || session.generation != generation || session.account.empty()) return std::nullopt;
  std::optional<WipedBytes> entropy = SyncSecrets::LoadKey(session.account);
  if (!entropy) return std::nullopt;
  std::shared_ptr<Keys const> check = KeysFrom(*entropy);
  if (!check || check->ChainTag() != session.keys->ChainTag()) return std::nullopt;
  return SyncPhrase::Words(*entropy);
}

inline std::optional<WipedBytes> FromHex(std::string const &hex) {
  if (hex.size() != SyncCrypto::KeyBytes * 2) return std::nullopt;
  WipedBytes out(SyncCrypto::KeyBytes);
  for (size_t i = 0; i < out.size(); i++) {
    unsigned value = 0;
    for (char c : hex.substr(i * 2, 2)) {
      unsigned digit = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10 : 16;
      if (digit == 16) return std::nullopt;
      value = value * 16 + digit;
    }
    out.data()[i] = static_cast<uint8_t>(value);
  }
  return std::move(out);
}

}
