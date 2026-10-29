#ifndef ARDIA_LINUX_AC_LINUX_BACKGROUND_DIALOGS_H_
#define ARDIA_LINUX_AC_LINUX_BACKGROUND_DIALOGS_H_

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace ardiacore {

inline constexpr char kLinuxFileChooserAnswers[] = "file-chooser.txt";
inline constexpr size_t kLinuxFileChooserFileLimit = 64 * 1024;
inline constexpr size_t kLinuxFileChooserPickLimit = 64;

inline std::vector<std::string> LinuxFileChooserPicks(std::string_view text) {
  std::vector<std::string> picks;
  if (text.size() > kLinuxFileChooserFileLimit) return picks;
  while (!text.empty() && picks.size() < kLinuxFileChooserPickLimit) {
    const size_t end = text.find('\n');
    std::string_view line = text.substr(0, end);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    if (!line.empty() && line.front() == '/' && line.find('\0') == std::string_view::npos) picks.emplace_back(line);
    if (end == std::string_view::npos) break;
    text.remove_prefix(end + 1);
  }
  return picks;
}

void InstallLinuxBackgroundFileDialogs();

}

#endif
