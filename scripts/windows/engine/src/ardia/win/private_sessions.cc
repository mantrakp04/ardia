#include "ardia/win/private_sessions.h"

#include <cstdint>
#include <memory>
#include <utility>

#include "ardia/win/host.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/supports_user_data.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_destroyer.h"

namespace ardia_win {

namespace {

constexpr base::TimeDelta kEndingLimit = base::Seconds(15);

int g_next_session_number = 1;

}

class PrivateSessions::Session : public base::SupportsUserData::Data {
 public:
  static Session* Of(Profile* profile) {
    return profile ? static_cast<Session*>(profile->GetUserData(Key()))
                   : nullptr;
  }

  static Session* For(Profile* profile) {
    if (Session* existing = Of(profile)) {
      return existing;
    }
    auto owned = std::make_unique<Session>(profile);
    Session* session = owned.get();
    profile->SetUserData(Key(), std::move(owned));
    return session;
  }

  explicit Session(Profile* profile)
      : number_(g_next_session_number++),
        identity_(reinterpret_cast<uintptr_t>(profile)),
        profile_(profile->GetWeakPtr()) {
    PrivateSessions::Get()->sessions_.insert(this);
  }

  ~Session() override {
    PrivateSessions::Get()->SessionGone(this, std::move(waiting));
  }

  int number() const { return number_; }
  Profile* identity() const { return reinterpret_cast<Profile*>(identity_); }
  Profile* profile() const { return profile_.get(); }

  std::set<std::string> names;
  std::vector<Waiting> waiting;
  bool ending = false;
  bool overdue = false;

 private:
  static const void* Key() {
    static const int key = 0;
    return &key;
  }

  const int number_;
  const uintptr_t identity_;
  base::WeakPtr<Profile> profile_;
};

PrivateSessions::Waiting::Waiting(std::string name,
                                  base::WeakPtr<Profile> original,
                                  Opened opened)
    : name(std::move(name)),
      original(std::move(original)),
      opened(std::move(opened)) {}

PrivateSessions::Waiting::Waiting(Waiting&&) = default;

PrivateSessions::Waiting& PrivateSessions::Waiting::operator=(Waiting&&) =
    default;

PrivateSessions::Waiting::~Waiting() = default;

PrivateSessions::PrivateSessions() = default;

PrivateSessions::~PrivateSessions() = default;

PrivateSessions* PrivateSessions::Get() {
  static base::NoDestructor<PrivateSessions> sessions;
  return sessions.get();
}

bool PrivateSessions::IsPrivateName(std::string_view name) {
  return name.find('@') != std::string_view::npos;
}

void PrivateSessions::Open(const std::string& name,
                           Profile* original,
                           Opened opened) {
  if (!original || original->IsOffTheRecord() || released_.contains(name)) {
    std::move(opened).Run(nullptr);
    return;
  }
  if (Profile* current = original->GetPrimaryOTRProfile(false)) {
    Session* session = Session::For(current);
    if (session->ending || current->ShutdownStarted()) {
      if (!session->ending) {
        session->ending = true;
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
            FROM_HERE,
            base::BindOnce(&PrivateSessions::Overdue,
                           weak_factory_.GetWeakPtr(), current->GetWeakPtr()),
            kEndingLimit);
      }
      if (session->overdue) {
        std::move(opened).Run(nullptr);
        return;
      }
      session->waiting.emplace_back(name, original->GetWeakPtr(),
                                    std::move(opened));
      return;
    }
    session->names.insert(name);
    std::move(opened).Run(current);
    return;
  }
  Profile* fresh = original->GetPrimaryOTRProfile(true);
  if (!fresh) {
    std::move(opened).Run(nullptr);
    return;
  }
  Session::For(fresh)->names.insert(name);
  std::move(opened).Run(fresh);
}

void PrivateSessions::Release(const std::string& name) {
  if (!IsPrivateName(name)) {
    return;
  }
  released_.insert(name);
  std::vector<Waiting> refused;
  Session* ended = nullptr;
  for (Session* session : sessions_) {
    for (auto entry = session->waiting.begin();
         entry != session->waiting.end();) {
      if (entry->name == name) {
        refused.push_back(std::move(*entry));
        entry = session->waiting.erase(entry);
      } else {
        ++entry;
      }
    }
    if (session->names.erase(name) && session->names.empty() &&
        !session->ending) {
      ended = session;
    }
  }
  if (ended) {
    End(ended);
  }
  Refuse(std::move(refused));
}

int PrivateSessions::SessionNumber(Profile* profile) const {
  if (!profile || !profile->IsOffTheRecord()) {
    return 0;
  }
  Session* session = Session::Of(profile);
  return session ? session->number() : 0;
}

int PrivateSessions::LiveSessions() const {
  return static_cast<int>(sessions_.size());
}

void PrivateSessions::SessionGone(Session* session,
                                  std::vector<Waiting> waiting) {
  sessions_.erase(session);
  Host::Get()->ForgetProfile(session->identity());
  if (waiting.empty()) {
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&PrivateSessions::Resume,
                                weak_factory_.GetWeakPtr(), std::move(waiting)));
}

void PrivateSessions::End(Session* session) {
  Profile* profile = session->profile();
  if (!profile) {
    return;
  }
  session->ending = true;
  base::WeakPtr<Profile> weak = profile->GetWeakPtr();
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&PrivateSessions::Overdue, weak_factory_.GetWeakPtr(),
                     weak),
      kEndingLimit);
  if (Host::Get()->CloseBrowsersOf(profile) == 0 && weak) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(weak.get());
  }
}

void PrivateSessions::Resume(std::vector<Waiting> waiting) {
  for (Waiting& entry : waiting) {
    Open(entry.name, entry.original.get(), std::move(entry.opened));
  }
}

void PrivateSessions::Overdue(base::WeakPtr<Profile> profile) {
  Session* session = profile ? Session::Of(profile.get()) : nullptr;
  if (!session || !session->ending || session->overdue) {
    return;
  }
  if (Host::Get()->BrowsersOf(profile.get()) == 0) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(profile.get());
    session = profile ? Session::Of(profile.get()) : nullptr;
    if (!session) {
      return;
    }
  }
  session->overdue = true;
  LOG(ERROR) << "Ardia: a private session has not ended "
             << kEndingLimit.InSeconds()
             << " s after its last release; private windows of its profile "
                "are refused until it does";
  std::vector<Waiting> waiting = std::move(session->waiting);
  session->waiting.clear();
  Refuse(std::move(waiting));
}

void PrivateSessions::Refuse(std::vector<Waiting> waiting) {
  for (Waiting& entry : waiting) {
    std::move(entry.opened).Run(nullptr);
  }
}

}
