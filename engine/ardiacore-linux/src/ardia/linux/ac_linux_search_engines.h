#ifndef ARDIA_LINUX_AC_LINUX_SEARCH_ENGINES_H_
#define ARDIA_LINUX_AC_LINUX_SEARCH_ENGINES_H_

#include <optional>
#include <string>

namespace ardiacore {

std::optional<std::string> SetLinuxDefaultSearchEngine(std::string name, std::string keyword, std::string url);

}

#endif
