#pragma once
#include <vector>
#include "base/types/expected.h"
#include "components/password_manager/core/browser/password_store/password_store_backend_error.h"
#include "components/password_manager/core/browser/password_store/stored_credential.h"
namespace password_manager {
class PasswordStoreInterface;
class PasswordStoreConsumer {
 public:
  virtual ~PasswordStoreConsumer() = default;
  virtual void OnGetPasswordStoreResultsOrErrorFrom(
      PasswordStoreInterface* store,
      base::expected<std::vector<StoredCredential>, PasswordStoreBackendError> results) = 0;
};
}
