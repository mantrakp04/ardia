// Copyright 2026 Ardia. Apache-2.0.

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ref.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "base/types/expected.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/password_manager/factories/profile_password_store_factory.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/password_manager/core/browser/features/password_features.h"
#include "components/password_manager/core/browser/password_manager_util.h"
#include "components/password_manager/core/browser/password_store/password_store_backend_error.h"
#include "components/password_manager/core/browser/password_store/password_store_consumer.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"
#include "components/password_manager/core/browser/password_store/stored_credential.h"
#include "components/password_manager/core/browser/password_string.h"
#include "url/gurl.h"

namespace ardia {
namespace {

using password_manager::PasswordForm;
using password_manager::PasswordStoreBackendError;
using password_manager::PasswordStoreInterface;
using password_manager::StoredCredential;
using Credentials = std::vector<StoredCredential>;
using CredentialsOrError = base::expected<Credentials, PasswordStoreBackendError>;

constexpr size_t kMaxReplaceArgsBytes = 64 * 1024;
constexpr base::TimeDelta kReplaceTimeout = base::Seconds(30);

struct Login {
  std::string realm;
  GURL url;
  std::u16string username;
};

std::optional<Login> LoginAt(const std::string& origin, const std::string& username) {
  const GURL url(origin);
  if (!url.is_valid()) {
    return std::nullopt;
  }
  std::string realm = password_manager_util::GetSignonRealm(url);
  if (realm != origin + "/") {
    return std::nullopt;
  }
  return Login{std::move(realm), url, base::UTF8ToUTF16(username)};
}

bool SameLogin(const StoredCredential& credential, const Login& login) {
  return credential.signon_realm == login.realm && credential.username_value == login.username;
}

bool Replaceable(const StoredCredential& credential, const Login& login) {
  return SameLogin(credential, login) && !credential.blocked_by_user &&
         !credential.federation_origin.IsValid();
}

bool HoldsKeyOf(const StoredCredential& credential, const Login& login) {
  return SameLogin(credential, login) && credential.url == login.url &&
         credential.username_element.empty() && credential.password_element.empty();
}

void Forget(Credentials& credentials) {
  for (StoredCredential& credential : credentials) {
    credential.password_value.clear();
  }
}

password_manager::PasswordString StoredPassword(const std::u16string& password) {
  std::u16string copy = password;
  password_manager::PasswordString stored(std::move(copy));
  Cleanse(copy);
  return stored;
}

class ReplacesState;

class Replace : public password_manager::PasswordStoreConsumer {
 public:
  Replace(ReplacesState& owner,
          Reply reply,
          scoped_refptr<PasswordStoreInterface> store,
          Login login,
          const std::u16string& password)
      : owner_(owner),
        reply_(std::move(reply)),
        store_(std::move(store)),
        login_(std::move(login)),
        password_(password) {}

  ~Replace() override {
    Cleanse(password_);
    if (!settled_) {
      reply_.Error("closed");
    }
  }

  void Start() {
    timeout_.Start(FROM_HERE, kReplaceTimeout,
                   base::BindOnce(&Replace::Finish, weak_factory_.GetWeakPtr(),
                                  std::string_view("The password store didn't answer")));
    Read(Step::kWrite);
  }

  void OnGetPasswordStoreResultsOrErrorFrom(PasswordStoreInterface*,
                                            CredentialsOrError result) override {
    if (!result.has_value()) {
      return Finish("unreadable");
    }
    Credentials credentials = std::move(*result);
    if (step_ == Step::kWrite) {
      Write(credentials);
    } else {
      Verify(credentials);
    }
    Forget(credentials);
  }

 private:
  enum class Step { kWrite, kVerify };

  void Read(Step step) {
    step_ = step;
    store_->GetAllLogins(weak_factory_.GetWeakPtr());
  }

  void Write(Credentials& credentials) {
    Credentials changes;
    bool found = false;
    for (StoredCredential& credential : credentials) {
      if (!Replaceable(credential, login_)) {
        continue;
      }
      found = true;
      if (credential.password_value == password_) {
        continue;
      }
      credential.password_value = StoredPassword(password_);
      credential.date_password_modified = base::Time::Now();
      credential.password_issues.clear();
      changes.push_back(std::move(credential));
    }
    if (found && changes.empty()) {
      return Finish({});
    }
    base::OnceClosure wrote = base::BindOnce(&Replace::Read, weak_factory_.GetWeakPtr(), Step::kVerify);
    if (found) {
      return store_->UpdateLogins(std::move(changes), std::move(wrote));
    }
    if (std::ranges::any_of(credentials, [this](const StoredCredential& credential) {
          return HoldsKeyOf(credential, login_);
        })) {
      return Finish("A blocked or federated entry holds this login");
    }
    store_->AddLogin(Added(), std::move(wrote));
  }

  StoredCredential Added() const {
    StoredCredential added;
    added.scheme = PasswordForm::Scheme::kHtml;
    added.url = login_.url;
    added.signon_realm = login_.realm;
    added.username_value = login_.username;
    added.password_value = StoredPassword(password_);
    added.type = PasswordForm::Type::kManuallyAdded;
    added.date_created = base::Time::Now();
    added.date_password_modified = added.date_created;
    added.in_store = PasswordForm::Store::kProfileStore;
    return added;
  }

  void Verify(const Credentials& credentials) {
    bool found = false;
    bool current = true;
    for (const StoredCredential& credential : credentials) {
      if (Replaceable(credential, login_)) {
        found = true;
        current = current && credential.password_value == password_;
      }
    }
    Finish(found && current ? std::string_view() : std::string_view("The login changed while it was being saved"));
  }

  void Finish(std::string_view error);

  const raw_ref<ReplacesState> owner_;
  Reply reply_;
  bool settled_ = false;
  scoped_refptr<PasswordStoreInterface> store_;
  const Login login_;
  std::u16string password_;
  Step step_ = Step::kWrite;
  base::OneShotTimer timeout_;
  base::WeakPtrFactory<Replace> weak_factory_{this};
};

class ReplacesState : public ProfileState {
 public:
  explicit ReplacesState(Profile* profile) : ProfileState(profile) {}

  void Start(Reply reply, scoped_refptr<PasswordStoreInterface> store, Login login, const std::u16string& password) {
    replaces_.push_back(std::make_unique<Replace>(*this, std::move(reply), std::move(store), std::move(login), password));
    replaces_.back()->Start();
  }

  void Done(Replace* replace) {
    auto found = std::ranges::find_if(replaces_, [replace](const auto& owned) { return owned.get() == replace; });
    if (found == replaces_.end()) {
      return;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->DeleteSoon(FROM_HERE, std::move(*found));
    replaces_.erase(found);
  }

 private:
  void Release() override { replaces_.clear(); }

  std::vector<std::unique_ptr<Replace>> replaces_;
};

void Replace::Finish(std::string_view error) {
  if (settled_) {
    return;
  }
  settled_ = true;
  weak_factory_.InvalidateWeakPtrs();
  timeout_.Stop();
  Cleanse(password_);
  if (error.empty()) {
    reply_.Ok();
  } else {
    reply_.Error(error);
  }
  owner_->Done(this);
}

}
}

AC_PROFILE_CALL(ac_passwords_replace, ardia::Sensitive{ardia::kMaxReplaceArgsBytes}) {
  if (base::FeatureList::IsEnabled(password_manager::features::kSkipUndecryptablePasswords)) {
    return call.TakeReply().Error("partial password reads");
  }
  std::optional<ardia::Secret> password = call.SecretAt("password");
  if (!password) {
    return call.TakeReply().Error("bad arguments");
  }
  std::optional<ardia::Login> login = ardia::LoginAt(call.String("origin"), call.String("username"));
  if (!login || password->value().empty()) {
    return call.TakeReply().Error("origin and password required");
  }
  scoped_refptr<password_manager::PasswordStoreInterface> store =
      ProfilePasswordStoreFactory::GetForProfile(call.profile(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!store) {
    return call.TakeReply().Error("no password store");
  }
  std::u16string password16 = base::UTF8ToUTF16(password->value());
  ardia::StateFor<ardia::ReplacesState>(call.profile())
      .Start(call.TakeReply(), std::move(store), std::move(*login), password16);
  ardia::Cleanse(password16);
}
