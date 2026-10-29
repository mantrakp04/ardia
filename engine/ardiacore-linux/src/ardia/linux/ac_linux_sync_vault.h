#ifndef ARDIA_LINUX_AC_LINUX_SYNC_VAULT_H_
#define ARDIA_LINUX_AC_LINUX_SYNC_VAULT_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_sync_crypto.h"

namespace ardia::linux_sync {

inline constexpr char kFileExtension[] = ".nns";
inline constexpr char kStagingPrefix[] = ".ardia-staging-";
inline constexpr char kSyncthingPrefix[] = ".syncthing.";
inline constexpr char kSyncthingSuffix[] = ".tmp";
inline constexpr size_t kMaxSyncFileBytes = 64u * 1024 * 1024;
inline constexpr size_t kMaxFolderPathBytes = 4096;
inline constexpr int64_t kStaleStagingSeconds = 3600;

bool ValidFolderPath(std::string_view path);
bool DirectoryExists(const std::string& path);
bool HasSyncData(const std::string& folder);

struct FolderFacts {
  bool exists = false;
  bool writable = false;
  bool has_sync_data = false;
};

FolderFacts InspectFolder(const std::string& path);

struct SyncFile {
  std::string id;
  Bytes payload;
};

struct DamagedFile {
  std::string id;
  double age_seconds = 0;
};

struct Listing {
  std::vector<SyncFile> files;
  std::vector<std::string> pending;
  std::vector<DamagedFile> damaged;
  std::vector<std::string> present;
};

struct VaultError {
  bool ok() const { return message.empty(); }
  std::string message;
};

class Vault {
 public:
  Vault(std::string folder, const SyncKeys& keys);

  std::string ChainPath() const;
  std::string ScopePath(std::string_view scope) const;
  bool ChainExists() const;
  VaultError CreateChain() const;
  VaultError Write(std::string_view scope, const Bytes& payload, std::string* id) const;
  VaultError WriteAs(std::string_view scope, const Bytes& payload, const std::string& id) const;
  Listing Read(std::string_view scope, const std::vector<std::string>& known, int64_t now_seconds) const;
  void Remove(std::string_view scope, const std::vector<std::string>& ids) const;
  VaultError DeleteChain() const;

 private:
  std::string folder_;
  const SyncKeys& keys_;
};

int64_t NowSeconds();

using RemoveTreeHook = void (*)(const std::string& path);
void SetRemoveTreeHookForTesting(RemoveTreeHook hook);

}

#endif
