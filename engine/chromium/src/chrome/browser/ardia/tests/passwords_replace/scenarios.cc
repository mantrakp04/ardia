#include <cassert>
#include <cstdio>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/task/sequenced_task_runner.h"
#include "base/timer/timer.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "components/password_manager/core/browser/features/password_features.h"
#include "components/password_manager/core/browser/password_store/password_store_interface.h"

void ac_passwords_replace(ardia::Call& call);
extern const ardia::Sensitive ac_passwords_replace_sensitive;

namespace {

using password_manager::PasswordForm;
using password_manager::PasswordStoreConsumer;
using password_manager::PasswordString;
using password_manager::StoredCredential;

struct Row {
  std::string realm;
  std::u16string username;
  std::u16string password;
  bool blocked = false;
  bool federated = false;
  std::u16string username_element;
  std::string url;
};

StoredCredential Make(const Row& row) {
  StoredCredential credential;
  credential.signon_realm = row.realm;
  credential.url = GURL(row.url.empty() ? row.realm : row.url);
  credential.username_value = row.username;
  credential.password_value = PasswordString(std::u16string(row.password));
  credential.blocked_by_user = row.blocked;
  credential.federation_origin.valid = row.federated;
  credential.username_element = row.username_element;
  credential.in_store = PasswordForm::Store::kProfileStore;
  credential.password_issues[1] = 1;
  return credential;
}

StoredCredential Copy(const StoredCredential& from) {
  StoredCredential to;
  to.scheme = from.scheme;
  to.signon_realm = from.signon_realm;
  to.url = from.url;
  to.federation_origin = from.federation_origin;
  to.username_element = from.username_element;
  to.password_element = from.password_element;
  to.username_value = from.username_value;
  to.password_value = PasswordString(from.password_value.value());
  to.date_created = from.date_created;
  to.date_password_modified = from.date_password_modified;
  to.blocked_by_user = from.blocked_by_user;
  to.type = from.type;
  to.in_store = from.in_store;
  to.password_issues = from.password_issues;
  return to;
}

bool SameKey(const StoredCredential& a, const StoredCredential& b) {
  return a.signon_realm == b.signon_realm && a.url == b.url && a.username_element == b.username_element &&
         a.username_value == b.username_value && a.password_element == b.password_element;
}

base::SequencedTaskRunner& Runner() { return *base::SequencedTaskRunner::GetCurrentDefault(); }

class FakeStore : public password_manager::PasswordStoreInterface {
 public:
  std::vector<StoredCredential> rows;
  int reads = 0;
  int adds = 0;
  int updates = 0;
  bool answers = true;
  bool fails = false;
  bool drops_writes = false;
  std::function<void(FakeStore&)> before_write;

  void Seed(const std::vector<Row>& seeded) {
    for (const Row& row : seeded) rows.push_back(Make(row));
  }

  void GetAllLogins(base::WeakPtr<PasswordStoreConsumer> consumer) override {
    ++reads;
    if (!answers) return;
    Runner().PostTask(FROM_HERE, base::OnceClosure([this, consumer]() {
      PasswordStoreConsumer* target = consumer.get();
      if (!target) return;
      if (fails) {
        return target->OnGetPasswordStoreResultsOrErrorFrom(
            this, base::unexpected<password_manager::PasswordStoreBackendError>{{}});
      }
      std::vector<StoredCredential> snapshot;
      for (const StoredCredential& row : rows) snapshot.push_back(Copy(row));
      target->OnGetPasswordStoreResultsOrErrorFrom(this, std::move(snapshot));
    }));
  }

  void AddLogin(StoredCredential form, base::OnceClosure completion) override {
    ++adds;
    Write(OnceWrite([this, form = std::move(form)]() mutable {
      for (StoredCredential& row : rows) {
        if (SameKey(row, form)) {
          row = std::move(form);
          return;
        }
      }
      rows.push_back(std::move(form));
    }), std::move(completion));
  }

  void UpdateLogins(std::vector<StoredCredential> forms, base::OnceClosure completion) override {
    ++updates;
    Write(OnceWrite([this, forms = std::move(forms)]() mutable {
      for (StoredCredential& form : forms) {
        for (StoredCredential& row : rows) {
          if (SameKey(row, form)) row = std::move(form);
        }
      }
    }), std::move(completion));
  }

 private:
  using OnceWrite = base::OnceClosure;

  void Write(OnceWrite write, base::OnceClosure completion) {
    Runner().PostTask(FROM_HERE, base::OnceClosure([this, write = std::move(write),
                                                    completion = std::move(completion)]() mutable {
      if (before_write) std::exchange(before_write, nullptr)(*this);
      if (!drops_writes) std::move(write).Run();
      std::move(completion).Run();
    }));
  }
};

struct World {
  Profile profile;
  std::shared_ptr<FakeStore> profile_store = std::make_shared<FakeStore>();
  std::shared_ptr<FakeStore> account_store = std::make_shared<FakeStore>();
  World() {
    profile.profile_store = profile_store;
    profile.account_store = account_store;
  }
  ~World() {
    for (auto& [key, state] : profile.states) state->WillBeDestroyed();
    profile.states.clear();
    Runner().RunAll();
    base::OneShotTimer::running.clear();
  }
};

ardia::Outcome Replace(World& world, const std::string& origin, const std::string& username,
                       std::optional<std::string> password, bool run = true) {
  ardia::Outcome outcome;
  ardia::Call call(&world.profile, {{"origin", origin}, {"username", username}}, std::move(password), &outcome);
  ac_passwords_replace(call);
  if (run) Runner().RunAll();
  return outcome;
}

const StoredCredential* Find(const FakeStore& store, const std::string& realm, const std::u16string& username,
                             const std::u16string& element = u"") {
  const StoredCredential* found = nullptr;
  for (const StoredCredential& row : store.rows) {
    if (row.signon_realm == realm && row.username_value == username && row.username_element == element) {
      assert(!found);
      found = &row;
    }
  }
  return found;
}

std::u16string PasswordOf(const FakeStore& store, const std::string& realm, const std::u16string& username,
                          const std::u16string& element = u"") {
  const StoredCredential* row = Find(store, realm, username, element);
  assert(row);
  return row->password_value.value();
}

void Ok(const ardia::Outcome& outcome) {
  if (outcome.replies != 1 || !outcome.ok) {
    std::fprintf(stderr, "expected ok, got %d replies: %s\n", outcome.replies, outcome.error.c_str());
  }
  assert(outcome.replies == 1 && outcome.ok);
}

void Failed(const ardia::Outcome& outcome, const std::string& error) {
  assert(outcome.replies == 1 && !outcome.ok);
  if (outcome.error != error) std::fprintf(stderr, "expected %s, got %s\n", error.c_str(), outcome.error.c_str());
  assert(outcome.error == error);
}

void GroupedRealmsKeepTheirOwnPasswords() {
  World world;
  world.profile_store->Seed({{"https://a.example.com/", u"me", u"shared"}, {"https://b.example.com/", u"me", u"shared"}});
  Ok(Replace(world, "https://a.example.com", "me", "fresh-a"));
  assert(world.profile_store->rows.size() == 2);
  assert(PasswordOf(*world.profile_store, "https://a.example.com/", u"me") == u"fresh-a");
  assert(PasswordOf(*world.profile_store, "https://b.example.com/", u"me") == u"shared");
  const StoredCredential* a = Find(*world.profile_store, "https://a.example.com/", u"me");
  assert(a->password_issues.empty() && !a->date_password_modified.is_null());
  assert(!Find(*world.profile_store, "https://b.example.com/", u"me")->password_issues.empty());
  Ok(Replace(world, "https://b.example.com", "me", "fresh-b"));
  assert(world.profile_store->rows.size() == 2);
  assert(world.profile_store->adds == 0);
  assert(PasswordOf(*world.profile_store, "https://a.example.com/", u"me") == u"fresh-a");
  assert(PasswordOf(*world.profile_store, "https://b.example.com/", u"me") == u"fresh-b");
}

void EveryFormOfTheLoginChanges() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"old", false, false, u"", "https://a.test/login"},
                             {"https://a.test/", u"me", u"old", false, false, u"email", "https://a.test/signin"},
                             {"https://a.test/", u"you", u"other"}});
  Ok(Replace(world, "https://a.test", "me", "new"));
  assert(world.profile_store->rows.size() == 3);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"new");
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me", u"email") == u"new");
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"you") == u"other");
}

void MissingLoginIsAddedToTheProfileStore() {
  World world;
  world.profile_store->Seed({{"https://b.test/", u"me", u"kept"}});
  Ok(Replace(world, "https://a.test", "me", "added"));
  assert(world.profile_store->adds == 1 && world.profile_store->rows.size() == 2);
  const StoredCredential* added = Find(*world.profile_store, "https://a.test/", u"me");
  assert(added && added->password_value.value() == u"added");
  assert(added->url == GURL("https://a.test/"));
  assert(added->type == PasswordForm::Type::kManuallyAdded);
  assert(added->in_store == PasswordForm::Store::kProfileStore);
  assert(added->scheme == PasswordForm::Scheme::kHtml);
  assert(!added->date_created.is_null() && added->date_created == added->date_password_modified);
  assert(PasswordOf(*world.profile_store, "https://b.test/", u"me") == u"kept");
}

void NonAsciiLoginsKeepTheirText() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"jöse", u"old"}});
  Ok(Replace(world, "https://a.test", "jöse", "pässwörd 日本 🔑"));
  assert(world.profile_store->rows.size() == 1);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"jöse") == u"pässwörd 日本 🔑");
}

void NonCanonicalOriginsAreRefused() {
  World world;
  for (const char* origin : {"https://A.test", "https://a.test?x=1", "https://a.test/"}) {
    Failed(Replace(world, origin, "me", "new"), "origin and password required");
  }
  assert(world.profile_store->reads == 0);
}

void SamePasswordWritesNothing() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"same"}});
  Ok(Replace(world, "https://a.test", "me", "same"));
  assert(world.profile_store->adds == 0 && world.profile_store->updates == 0);
  assert(!Find(*world.profile_store, "https://a.test/", u"me")->password_issues.empty());
}

void BlockedAndFederatedEntriesAreLeftAlone() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"", u"", true}, {"https://a.test/", u"fed", u"", false, true}});
  Ok(Replace(world, "https://a.test", "me", "pw"));
  assert(world.profile_store->rows.size() == 3);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"pw");
  Failed(Replace(world, "https://a.test", "", "pw"), "A blocked or federated entry holds this login");
  Failed(Replace(world, "https://a.test", "fed", "pw"), "A blocked or federated entry holds this login");
  assert(world.profile_store->rows.size() == 3);
  assert(Find(*world.profile_store, "https://a.test/", u"")->blocked_by_user);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"") == u"");
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"fed") == u"");
  assert(Find(*world.profile_store, "https://a.test/", u"fed")->federation_origin.IsValid());
}

void BlockedEntryWithAnotherKeyDoesNotStopTheAdd() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"", u"", true, false, u"user", "https://a.test/form"}});
  Ok(Replace(world, "https://a.test", "", "pw"));
  assert(world.profile_store->rows.size() == 2);
  assert(Find(*world.profile_store, "https://a.test/", u"", u"user")->blocked_by_user);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"") == u"pw");
}

void AccountStoreNeverMasksTheProfileStore() {
  World world;
  world.account_store->Seed({{"https://a.test/", u"me", u"account"}});
  Ok(Replace(world, "https://a.test", "me", "synced"));
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"synced");
  assert(PasswordOf(*world.account_store, "https://a.test/", u"me") == u"account");
  world.profile_store->rows.clear();
  world.profile_store->Seed({{"https://a.test/", u"me", u"profile"}});
  Ok(Replace(world, "https://a.test", "me", "again"));
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"again");
  assert(PasswordOf(*world.account_store, "https://a.test/", u"me") == u"account");
  assert(world.account_store->reads == 0 && world.account_store->adds == 0 && world.account_store->updates == 0);
}

void LoginDeletedDuringTheWriteStaysDeleted() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"old"}});
  world.profile_store->before_write = [](FakeStore& store) { store.rows.clear(); };
  Failed(Replace(world, "https://a.test", "me", "new"), "The login changed while it was being saved");
  assert(world.profile_store->updates == 1 && world.profile_store->adds == 0);
  assert(world.profile_store->rows.empty());
}

void ConcurrentChangeIsKept() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"old"}});
  world.profile_store->before_write = [](FakeStore& store) {
    store.rows.clear();
    store.Seed({{"https://a.test/", u"me", u"racing", false, false, u"", "https://a.test/other"}});
  };
  Failed(Replace(world, "https://a.test", "me", "new"), "The login changed while it was being saved");
  assert(world.profile_store->rows.size() == 1);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"racing");
}

void StoreThatNeverTakesTheChangeFails() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"old"}});
  world.profile_store->drops_writes = true;
  const int delayed = Runner().delayed();
  Failed(Replace(world, "https://a.test", "me", "new"), "The login changed while it was being saved");
  assert(Runner().delayed() == delayed);
  assert(PasswordOf(*world.profile_store, "https://a.test/", u"me") == u"old");
}

void UnreadableAndSilentStoresFail() {
  {
    World world;
    world.profile_store->fails = true;
    Failed(Replace(world, "https://a.test", "me", "new"), "unreadable");
  }
  {
    World world;
    world.profile_store->answers = false;
    ardia::Outcome outcome = Replace(world, "https://a.test", "me", "new");
    assert(outcome.replies == 0);
    assert(base::OneShotTimer::running.size() == 1);
    base::OneShotTimer::FireAll();
    Runner().RunAll();
    Failed(outcome, "The password store didn't answer");
  }
}

void ProfileTeardownAnswersOnce() {
  World world;
  world.profile_store->Seed({{"https://a.test/", u"me", u"old"}});
  ardia::Outcome outcome = Replace(world, "https://a.test", "me", "new", false);
  assert(outcome.replies == 0);
  for (auto& [key, state] : world.profile.states) state->WillBeDestroyed();
  Failed(outcome, "closed");
  assert(base::OneShotTimer::running.empty());
  Runner().RunAll();
  assert(outcome.replies == 1);
  assert(world.profile_store->updates == 0);
}

void BadRequestsAreRefused() {
  World world;
  Failed(Replace(world, "https://a.test", "me", std::nullopt), "bad arguments");
  Failed(Replace(world, "https://a.test", "me", ""), "origin and password required");
  Failed(Replace(world, "", "me", "pw"), "origin and password required");
  Failed(Replace(world, "https://a.test/", "me", "pw"), "origin and password required");
  Failed(Replace(world, "https://a.test/path", "me", "pw"), "origin and password required");
  Failed(Replace(world, "HTTPS://A.test", "me", "pw"), "origin and password required");
  password_manager::features::kSkipUndecryptablePasswords.enabled = true;
  Failed(Replace(world, "https://a.test", "me", "pw"), "partial password reads");
  password_manager::features::kSkipUndecryptablePasswords.enabled = false;
  world.profile.profile_store = nullptr;
  Failed(Replace(world, "https://a.test", "me", "pw"), "no password store");
  assert(world.profile_store->reads == 0);
}

}

int main() {
  assert(ac_passwords_replace_sensitive.max_bytes == 64 * 1024);
  GroupedRealmsKeepTheirOwnPasswords();
  EveryFormOfTheLoginChanges();
  MissingLoginIsAddedToTheProfileStore();
  NonAsciiLoginsKeepTheirText();
  NonCanonicalOriginsAreRefused();
  SamePasswordWritesNothing();
  BlockedAndFederatedEntriesAreLeftAlone();
  BlockedEntryWithAnotherKeyDoesNotStopTheAdd();
  AccountStoreNeverMasksTheProfileStore();
  LoginDeletedDuringTheWriteStaysDeleted();
  ConcurrentChangeIsKept();
  StoreThatNeverTakesTheChangeFails();
  UnreadableAndSilentStoresFail();
  ProfileTeardownAnswersOnce();
  BadRequestsAreRefused();
  std::puts("passwords replace scenarios passed");
}
