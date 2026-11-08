#pragma once
#include <map>
#include <string>
#include "base/time/time.h"
#include "components/password_manager/core/browser/password_string.h"
#include "url/gurl.h"
namespace password_manager {
struct PasswordForm {
  enum class Scheme { kHtml, kBasic };
  enum class Type { kFormSubmission, kManuallyAdded };
  enum class Store { kNotSet, kProfileStore, kAccountStore };
};
struct StoredCredential {
  StoredCredential() = default;
  StoredCredential(StoredCredential&&) = default;
  StoredCredential& operator=(StoredCredential&&) = default;
  StoredCredential(const StoredCredential&) = delete;
  StoredCredential& operator=(const StoredCredential&) = delete;
  PasswordForm::Scheme scheme = PasswordForm::Scheme::kHtml;
  std::string signon_realm;
  GURL url;
  url::SchemeHostPort federation_origin;
  std::u16string username_element;
  std::u16string password_element;
  std::u16string username_value;
  PasswordString password_value;
  base::Time date_created;
  base::Time date_password_modified;
  bool blocked_by_user = false;
  PasswordForm::Type type = PasswordForm::Type::kFormSubmission;
  PasswordForm::Store in_store = PasswordForm::Store::kNotSet;
  std::map<int, int> password_issues;
};
}
