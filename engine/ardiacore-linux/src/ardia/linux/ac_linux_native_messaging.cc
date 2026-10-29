#include "ardia/linux/ac_linux_native_messaging.h"

#include <sys/stat.h>

namespace ardia::linux_native_messaging {

namespace {

bool Absolute(std::string_view path) {
  return !path.empty() && path.front() == '/';
}

std::string Join(std::string_view directory, std::string_view name) {
  std::string path(directory);
  if (path.empty() || path.back() != '/') path.push_back('/');
  path.append(name);
  return path;
}

}

bool ValidHostName(std::string_view name) {
  if (name.empty() || name.front() == '.' || name.back() == '.') return false;
  bool previous_dot = false;
  for (const char c : name) {
    const bool dot = c == '.';
    if (dot && previous_dot) return false;
    previous_dot = dot;
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || dot) continue;
    return false;
  }
  return true;
}

std::string ConfigRoot(const Environment& environment) {
  if (!environment.chrome_config_home.empty()) return environment.chrome_config_home;
  if (!environment.xdg_config_home.empty()) return environment.xdg_config_home;
  if (Absolute(environment.home)) return Join(environment.home, ".config");
  return std::string();
}

std::vector<std::string> ExtraUserDirectories(const Environment& environment) {
  const std::string root = ConfigRoot(environment);
  if (root.empty()) return {};
  return {Join(Join(root, "chromium"), kHostsFolder)};
}

std::string FindManifest(const std::vector<std::string>& directories, std::string_view host_name) {
  if (!ValidHostName(host_name)) return std::string();
  const std::string file = std::string(host_name) + ".json";
  for (const std::string& directory : directories) {
    if (!Absolute(directory)) continue;
    const std::string path = Join(directory, file);
    struct stat info;
    if (stat(path.c_str(), &info) == 0 && S_ISREG(info.st_mode)) return path;
  }
  return std::string();
}

}
