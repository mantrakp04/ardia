#ifndef ARDIA_LINUX_AC_LINUX_USER_SCRIPTS_STORE_H_
#define ARDIA_LINUX_AC_LINUX_USER_SCRIPTS_STORE_H_

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>

namespace ardia::linux_user_scripts {

inline constexpr char kScriptsName[] = "Scripts";
inline constexpr size_t kManifestLimit = 1 << 20;
inline constexpr size_t kStatusLimit = 1 << 20;
inline constexpr size_t kGenerationLimit = 4096;
inline constexpr int kLockAttempts = 200;
inline constexpr int kLockRetryMicroseconds = 50000;

struct Folder {
  std::string state;
  std::optional<int64_t> generation;
  std::optional<std::string> path;
  std::optional<std::string> error;
  std::string token;
};

using ManifestCheck = std::function<std::optional<std::string>(int extension_fd, const std::string& manifest)>;

std::string ScriptsPath(const std::string& data_directory);
std::optional<int64_t> ParseGeneration(std::string_view text);
std::optional<std::string> CheckFile(int extension_fd, std::string_view relative, std::string_view at);
Folder Read(const std::string& data_directory, const ManifestCheck& check);
std::string Signature(const std::string& data_directory);
std::optional<std::string> ReadStatus(const std::string& data_directory);
std::optional<std::string> WriteStatus(const std::string& data_directory, std::string_view json);

}

#endif
