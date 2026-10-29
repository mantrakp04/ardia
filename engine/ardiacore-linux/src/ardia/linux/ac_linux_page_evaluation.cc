#include "ardia/linux/ac_linux_page_evaluation.h"

#include <utility>

#include "base/strings/stringprintf.h"

namespace ardiacore {

namespace {

bool BoundedText(const base::Value& value) {
  if (!value.is_string()) return false;
  const std::string& text = value.GetString();
  return text.size() <= kLinuxPageReplaceTextMax && text.find('\0') == std::string::npos;
}

}

std::optional<LinuxPageOperationMatch> MatchLinuxPageOperation(
    std::string_view code, const LinuxPageDigest& digest, std::span<const LinuxPageOperation> operations) {
  if (code.empty() || code.size() > kLinuxPageEvaluationCodeMax || !digest) return std::nullopt;
  for (const LinuxPageOperation& operation : operations) {
    if (operation.args == LinuxPageOperationArgs::kNone) {
      if (code.size() == operation.length && digest(code) == operation.sha256)
        return LinuxPageOperationMatch{&operation, {}};
      continue;
    }
    if (code.size() <= operation.length + 1 || code.back() != ')') continue;
    if (digest(code.substr(0, operation.length)) != operation.sha256) continue;
    return LinuxPageOperationMatch{&operation, code.substr(operation.length, code.size() - operation.length - 1)};
  }
  return std::nullopt;
}

std::string LinuxJavaScriptString(std::string_view text) {
  std::string out = "\"";
  for (size_t i = 0; i < text.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    if (c == '"' || c == '\\') {
      out += '\\';
      out += static_cast<char>(c);
    } else if (c < 0x20 || c == '<' || c == '>' || c == 0x7f) {
      out += base::StringPrintf("\\u%04x", c);
    } else if (c == 0xe2 && i + 2 < text.size() && static_cast<unsigned char>(text[i + 1]) == 0x80 &&
               (static_cast<unsigned char>(text[i + 2]) == 0xa8 || static_cast<unsigned char>(text[i + 2]) == 0xa9)) {
      out += static_cast<unsigned char>(text[i + 2]) == 0xa8 ? "\\u2028" : "\\u2029";
      i += 2;
    } else {
      out += static_cast<char>(c);
    }
  }
  return out + "\"";
}

std::optional<std::string> LinuxReplaceArguments(const base::Value& arguments) {
  if (!arguments.is_list()) return std::nullopt;
  const auto& list = arguments.GetList();
  if (list.size() != 3 || !BoundedText(list[0]) || !BoundedText(list[1]) || !list[2].is_bool()) return std::nullopt;
  return LinuxJavaScriptString(list[0].GetString()) + ", " + LinuxJavaScriptString(list[1].GetString()) + ", " +
         (list[2].GetBool() ? "true" : "false");
}

std::optional<std::string> LinuxPageEvaluationScript(
    std::string_view code, const LinuxPageDigest& digest, const LinuxPageJsonList& parse_list,
    std::span<const LinuxPageOperation> operations) {
  auto match = MatchLinuxPageOperation(code, digest, operations);
  if (!match) return std::nullopt;
  std::string body;
  if (match->operation->args == LinuxPageOperationArgs::kNone) {
    body = std::string(code);
  } else {
    if (!parse_list) return std::nullopt;
    auto parsed = parse_list("[" + std::string(match->arguments) + "]");
    auto arguments = parsed ? LinuxReplaceArguments(*parsed) : std::nullopt;
    if (!arguments) return std::nullopt;
    body = std::string(code.substr(0, match->operation->length)) + *arguments + ")";
  }
  return "(() => {\n"
         "let ardiaResult = null;\n"
         "const post = (kind, value) => { if (kind === \"result\" && ardiaResult === null && typeof value === \"string\") ardiaResult = value; };\n"
         "try {\n" + body + "\n;\n} catch (ardiaError) {}\n"
         "return ardiaResult;\n"
         "})()";
}

std::optional<std::string> LinuxPageEvaluationResult(const base::Value& value) {
  if (!value.is_string() || value.GetString().size() > kLinuxPageEvaluationResultMax) return std::nullopt;
  return value.GetString();
}

}
