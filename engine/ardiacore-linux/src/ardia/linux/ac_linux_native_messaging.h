#ifndef ARDIA_LINUX_AC_LINUX_NATIVE_MESSAGING_H_
#define ARDIA_LINUX_AC_LINUX_NATIVE_MESSAGING_H_

#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_native_messaging {

inline constexpr std::string_view kHostsFolder = "NativeMessagingHosts";

struct Environment {
  std::string home;
  std::string xdg_config_home;
  std::string chrome_config_home;
};

bool ValidHostName(std::string_view name);
std::string ConfigRoot(const Environment& environment);
std::vector<std::string> ExtraUserDirectories(const Environment& environment);
std::string FindManifest(const std::vector<std::string>& directories, std::string_view host_name);

}

#endif
