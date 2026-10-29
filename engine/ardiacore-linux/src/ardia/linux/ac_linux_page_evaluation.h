#ifndef ARDIA_LINUX_AC_LINUX_PAGE_EVALUATION_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_EVALUATION_H_

#include <stddef.h>

#include <functional>
#include <optional>
#include <span>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_page_operations.h"
#include "base/values.h"

namespace ardiacore {

inline constexpr size_t kLinuxPageEvaluationCodeMax = 64 * 1024;
inline constexpr size_t kLinuxPageEvaluationResultMax = 4 * 1024 * 1024;
inline constexpr size_t kLinuxPageReplaceTextMax = 4096;

using LinuxPageDigest = std::function<std::string(std::string_view)>;
using LinuxPageJsonList = std::function<std::optional<base::Value>(std::string_view)>;

struct LinuxPageOperationMatch {
  const LinuxPageOperation* operation = nullptr;
  std::string_view arguments;
};

std::optional<LinuxPageOperationMatch> MatchLinuxPageOperation(
    std::string_view code, const LinuxPageDigest& digest,
    std::span<const LinuxPageOperation> operations = kLinuxPageOperations);
std::optional<std::string> LinuxReplaceArguments(const base::Value& arguments);
std::string LinuxJavaScriptString(std::string_view text);
std::optional<std::string> LinuxPageEvaluationScript(
    std::string_view code, const LinuxPageDigest& digest, const LinuxPageJsonList& parse_list,
    std::span<const LinuxPageOperation> operations = kLinuxPageOperations);
std::optional<std::string> LinuxPageEvaluationResult(const base::Value& value);

}

#endif
