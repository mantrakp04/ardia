// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/core/ac_launch_switches.h"
#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/json/string_escape.h"
#include "base/memory/raw_ref.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/types/expected.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/password_manager/factories/account_password_store_factory.h"
#include "chrome/browser/password_manager/factories/profile_password_store_factory.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/password_manager/core/browser/features/password_features.h"
#include "components/password_manager/core/browser/password_store/password_store_backend_error.h"
#include "components/password_manager/core/browser/password_store/password_store_consumer.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"
#include "components/password_manager/core/browser/password_store/stored_credential.h"

namespace ardia {
namespace {

using password_manager::PasswordStoreBackendError;
using password_manager::PasswordStoreInterface;
using password_manager::StoredCredential;
using Credentials = std::vector<StoredCredential>;
using CredentialsOrError = base::expected<Credentials, PasswordStoreBackendError>;

enum class Store { kProfile, kAccount };

constexpr size_t kEscapedBytesPerUnit = 6;
constexpr size_t kBytesPerLogin = 96;

std::string_view NameOf(Store store) {
  return store == Store::kProfile ? "profile" : "account";
}

std::optional<base::TimeDelta> TestDelay(Store store) {
  const std::optional<std::string> value = ardiacore::TestValue("loginsDelay");
  if (!value) {
    return std::nullopt;
  }
  const std::string_view entry(*value);
  const size_t colon = entry.find(':');
  int ms = 0;
  if (colon == std::string_view::npos || entry.substr(0, colon) != NameOf(store) ||
      !base::StringToInt(entry.substr(colon + 1), &ms) || ms < 0) {
    return std::nullopt;
  }
  return base::Milliseconds(ms);
}

bool TestReleaseAfter(Store store) {
  return ardiacore::TestValue("loginsReleaseAfter") == NameOf(store);
}

bool Synced(const StoredCredential& credential) {
  return !credential.blocked_by_user && !credential.password_value.empty();
}

size_t JSONBound(const Credentials& profile, const Credentials& account) {
  size_t bytes = 32;
  for (const Credentials* list : {&profile, &account}) {
    for (const StoredCredential& credential : *list) {
      bytes += kBytesPerLogin +
               kEscapedBytesPerUnit * (credential.signon_realm.size() +
                                       credential.username_value.size() +
                                       credential.password_value.size());
    }
  }
  return bytes;
}

bool AppendLogin(const StoredCredential& credential, bool first, std::string& json) {
  if (!first) {
    json += ',';
  }
  json += "{\"realm\":";
  bool valid = base::EscapeJSONString(credential.signon_realm, true, &json);
  json += ",\"username\":";
  valid &= base::EscapeJSONString(credential.username_value, true, &json);
  json += ",\"password\":";
  std::u16string password = credential.password_value.value();
  valid &= base::EscapeJSONString(password, true, &json);
  Cleanse(password);
  json += ",\"created\":";
  json += base::NumberToString(credential.date_created.is_null()
                                   ? 0.0
                                   : credential.date_created.InMillisecondsFSinceUnixEpoch());
  json += '}';
  return valid;
}

class LoginsState;

class LoginsRead : public password_manager::PasswordStoreConsumer {
 public:
  LoginsRead(LoginsState& owner,
             Reply reply,
             scoped_refptr<PasswordStoreInterface> profile_store,
             scoped_refptr<PasswordStoreInterface> account_store)
      : owner_(owner),
        reply_(std::move(reply)),
        profile_store_(std::move(profile_store)),
        account_store_(std::move(account_store)) {}

  ~LoginsRead() override {
    if (!settled_) {
      reply_.Error("closed");
    }
  }

  void Start() {
    profile_store_->GetAllLogins(weak_factory_.GetWeakPtr());
    account_store_->GetAllLogins(weak_factory_.GetWeakPtr());
  }

  void OnGetPasswordStoreResultsOrErrorFrom(PasswordStoreInterface* from,
                                            CredentialsOrError result) override {
    const Store store =
        from == profile_store_.get() ? Store::kProfile : Store::kAccount;
    if (std::optional<base::TimeDelta> delay = TestDelay(store)) {
      base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE,
          base::BindOnce(&LoginsRead::Take, weak_factory_.GetWeakPtr(), store,
                         std::move(result)),
          *delay);
      return;
    }
    Take(store, std::move(result));
  }

 private:
  void Take(Store store, CredentialsOrError result);
  void Fail(std::string_view message);
  void Send();

  const raw_ref<LoginsState> owner_;
  Reply reply_;
  bool settled_ = false;
  scoped_refptr<PasswordStoreInterface> profile_store_;
  scoped_refptr<PasswordStoreInterface> account_store_;
  std::optional<Credentials> profile_;
  std::optional<Credentials> account_;
  base::WeakPtrFactory<LoginsRead> weak_factory_{this};
};

class LoginsState : public ProfileState {
 public:
  explicit LoginsState(Profile* profile) : ProfileState(profile) {}

  void Start(Reply reply,
             scoped_refptr<PasswordStoreInterface> profile_store,
             scoped_refptr<PasswordStoreInterface> account_store) {
    reads_.push_back(std::make_unique<LoginsRead>(*this, std::move(reply),
                                                  std::move(profile_store),
                                                  std::move(account_store)));
    reads_.back()->Start();
  }

  void Done(LoginsRead* read) {
    auto found = std::ranges::find_if(
        reads_, [read](const auto& owned) { return owned.get() == read; });
    if (found == reads_.end()) {
      return;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(
        FROM_HERE, std::move(*found));
    reads_.erase(found);
  }

  void PostDropAll() {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(&LoginsState::DropAll, weak_factory_.GetWeakPtr()));
  }

 private:
  void Release() override { DropAll(); }

  void DropAll() { reads_.clear(); }

  std::vector<std::unique_ptr<LoginsRead>> reads_;
  base::WeakPtrFactory<LoginsState> weak_factory_{this};
};

void LoginsRead::Take(Store store, CredentialsOrError result) {
  if (settled_) {
    return;
  }
  if (!result.has_value()) {
    return Fail("unreadable");
  }
  (store == Store::kProfile ? profile_ : account_) = std::move(*result);
  if (!profile_ || !account_) {
    if (TestReleaseAfter(store)) {
      owner_->PostDropAll();
    }
    return;
  }
  Send();
}

void LoginsRead::Fail(std::string_view message) {
  settled_ = true;
  profile_.reset();
  account_.reset();
  reply_.Error(message);
  owner_->Done(this);
}

void LoginsRead::Send() {
  std::string json;
  json.reserve(JSONBound(*profile_, *account_));
  json += "{\"logins\":[";
  bool first = true;
  bool valid = true;
  for (const Credentials* list : {&*profile_, &*account_}) {
    for (const StoredCredential& credential : *list) {
      if (!Synced(credential)) {
        continue;
      }
      valid &= AppendLogin(credential, first, json);
      first = false;
    }
  }
  json += "]}";
  profile_.reset();
  account_.reset();
  if (!valid) {
    Cleanse(json);
    return Fail("unreadable");
  }
  settled_ = true;
  reply_.SendSecretJSON(json);
  owner_->Done(this);
}

}
}

AC_PROFILE_CALL(ac_passwords_logins) {
  if (base::FeatureList::IsEnabled(
          password_manager::features::kSkipUndecryptablePasswords)) {
    return call.TakeReply().Error("partial password reads");
  }
  if (base::FeatureList::IsEnabled(
          password_manager::features::kUseProcessBoundPasswordString)) {
    return call.TakeReply().Error("process-bound password strings");
  }
  scoped_refptr<password_manager::PasswordStoreInterface> profile_store =
      ProfilePasswordStoreFactory::GetForProfile(
          call.profile(), ServiceAccessType::EXPLICIT_ACCESS);
  scoped_refptr<password_manager::PasswordStoreInterface> account_store =
      AccountPasswordStoreFactory::GetForProfile(
          call.profile(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!profile_store || !account_store) {
    return call.TakeReply().Error("no password store");
  }
  ardia::StateFor<ardia::LoginsState>(call.profile())
      .Start(call.TakeReply(), std::move(profile_store), std::move(account_store));
}
