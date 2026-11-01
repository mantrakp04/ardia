#ifndef ARDIA_LINUX_AC_LINUX_PAGE_PROMPT_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_PROMPT_POLICY_H_

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

namespace ardiacore::linux_page_prompts {

inline constexpr size_t kMaxPromptIdLength = 24;
inline constexpr size_t kMaxPendingExternalApps = 32;
inline constexpr size_t kMaxUsernameLength = 4096;

enum class PermissionAnswer { kAccept, kDeny, kDismiss };
enum class PermissionAction { kAccept, kAcceptThisTime, kDeny, kDismiss };

inline std::optional<PermissionAnswer> ParsePermissionAnswer(std::string_view result) {
  if (result == "accept") return PermissionAnswer::kAccept;
  if (result == "deny") return PermissionAnswer::kDeny;
  if (result == "dismiss") return PermissionAnswer::kDismiss;
  return std::nullopt;
}

inline PermissionAction DecidePermission(bool already_allowed, PermissionAnswer answer, bool remember,
                                         bool temporary_grants_supported) {
  if (already_allowed) {
    return answer == PermissionAnswer::kDeny && remember ? PermissionAction::kDeny : PermissionAction::kDismiss;
  }
  if (answer == PermissionAnswer::kAccept) {
    return !remember && temporary_grants_supported ? PermissionAction::kAcceptThisTime : PermissionAction::kAccept;
  }
  if (answer == PermissionAnswer::kDeny && remember) return PermissionAction::kDeny;
  return PermissionAction::kDismiss;
}

inline bool ValidPromptId(std::string_view id, char prefix) {
  if (id.size() < 2 || id.size() > kMaxPromptIdLength || id[0] != prefix || id[1] == '0') return false;
  for (size_t i = 1; i < id.size(); ++i) {
    if (id[i] < '0' || id[i] > '9') return false;
  }
  return true;
}

enum class PasswordState { kSave, kUpdate, kOther };
enum class PasswordAnswer { kSave, kUpdate, kNever, kNope, kDismiss };

inline std::optional<PasswordAnswer> ParsePasswordAnswer(std::string_view action) {
  if (action == "save") return PasswordAnswer::kSave;
  if (action == "update") return PasswordAnswer::kUpdate;
  if (action == "never") return PasswordAnswer::kNever;
  if (action == "nope") return PasswordAnswer::kNope;
  if (action == "dismiss") return PasswordAnswer::kDismiss;
  return std::nullopt;
}

inline bool PasswordAnswerFits(PasswordAnswer answer, PasswordState state) {
  switch (answer) {
    case PasswordAnswer::kSave:
    case PasswordAnswer::kUpdate:
      return state == PasswordState::kSave || state == PasswordState::kUpdate;
    case PasswordAnswer::kNever:
      return state == PasswordState::kSave;
    case PasswordAnswer::kNope:
      return state == PasswordState::kUpdate;
    case PasswordAnswer::kDismiss:
      return true;
  }
  return false;
}

enum class AutofillAnswer { kAccept, kDecline, kDismiss };

inline std::optional<AutofillAnswer> ParseAutofillAnswer(std::string_view action) {
  if (action == "accept") return AutofillAnswer::kAccept;
  if (action == "decline") return AutofillAnswer::kDecline;
  if (action == "dismiss") return AutofillAnswer::kDismiss;
  return std::nullopt;
}

inline bool KnownExternalApp(std::string_view program_name) {
  return !program_name.empty() && program_name != "xdg-open";
}

struct ExternalAppText {
  std::string title;
  std::string message;
  std::string remember;
};

inline ExternalAppText DescribeExternalApp(std::string_view app, std::string_view origin, std::string_view scheme,
                                           bool can_remember) {
  ExternalAppText text;
  if (app.empty()) {
    text.title = "No application is set to open this link";
    text.message = "This computer doesn’t have an app for “" + std::string(scheme) + ":” links.";
    return text;
  }
  text.title = "Open “" + std::string(app) + "”?";
  text.message = origin.empty() ? std::string("This page wants to open this application.")
                                : std::string(origin) + " wants to open this application.";
  if (can_remember) {
    text.remember = "Always allow " + std::string(origin) + " to open links of this type in " + std::string(app);
  }
  return text;
}

}

#endif
