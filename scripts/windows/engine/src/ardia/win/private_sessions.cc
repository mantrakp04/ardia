#include "ardia/win/private_sessions.h"

#include <utility>

#include "ardia/win/host.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_destroyer.h"

namespace ardia_win {

namespace {

constexpr base::TimeDelta kEndingLimit = base::Seconds(15);

}

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
  Profile* current = original->GetPrimaryOTRProfile(false);
  if (current && ending_.contains(current)) {
    waiting_[current].emplace_back(name, original->GetWeakPtr(),
                                   std::move(opened));
    return;
  }
  Profile* session = original->GetPrimaryOTRProfile(true);
  if (!session) {
    std::move(opened).Run(nullptr);
    return;
  }
  if (!observed_.IsObservingSource(session)) {
    observed_.AddObservation(session);
    numbers_[session] = next_number_++;
  }
  names_[session].insert(name);
  std::move(opened).Run(session);
}

void PrivateSessions::Release(const std::string& name) {
  if (!IsPrivateName(name)) {
    return;
  }
  released_.insert(name);
  std::vector<Waiting> refused;
  for (auto& [session, waiting] : waiting_) {
    for (auto entry = waiting.begin(); entry != waiting.end();) {
      if (entry->name == name) {
        refused.push_back(std::move(*entry));
        entry = waiting.erase(entry);
      } else {
        ++entry;
      }
    }
  }
  Profile* ended = nullptr;
  for (auto& [session, names] : names_) {
    if (names.erase(name) && names.empty()) {
      ended = session;
      break;
    }
  }
  if (ended) {
    names_.erase(ended);
    End(ended);
  }
  Refuse(std::move(refused));
}

int PrivateSessions::SessionNumber(Profile* profile) const {
  auto found = numbers_.find(profile);
  return found == numbers_.end() ? 0 : found->second;
}

int PrivateSessions::LiveSessions() const {
  return static_cast<int>(numbers_.size());
}

void PrivateSessions::OnProfileWillBeDestroyed(Profile* profile) {
  observed_.RemoveObservation(profile);
  names_.erase(profile);
  numbers_.erase(profile);
  ending_.erase(profile);
  Host::Get()->ForgetProfile(profile);
  auto found = waiting_.find(profile);
  if (found == waiting_.end()) {
    return;
  }
  std::vector<Waiting> waiting = std::move(found->second);
  waiting_.erase(found);
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&PrivateSessions::Resume,
                                weak_factory_.GetWeakPtr(), std::move(waiting)));
}

void PrivateSessions::End(Profile* session) {
  ending_.insert(session);
  base::WeakPtr<Profile> weak = session->GetWeakPtr();
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&PrivateSessions::Overdue, weak_factory_.GetWeakPtr(),
                     weak),
      kEndingLimit);
  if (Host::Get()->CloseBrowsersOf(session) == 0 && weak) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(weak.get());
  }
}

void PrivateSessions::Resume(std::vector<Waiting> waiting) {
  for (Waiting& entry : waiting) {
    Open(entry.name, entry.original.get(), std::move(entry.opened));
  }
}

void PrivateSessions::Overdue(base::WeakPtr<Profile> session) {
  if (!session || !ending_.contains(session.get())) {
    return;
  }
  if (Host::Get()->BrowsersOf(session.get()) == 0) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(session.get());
    return;
  }
  LOG(ERROR) << "Ardia: a private session still has windows "
             << kEndingLimit.InSeconds() << " s after its last release";
  auto found = waiting_.find(session.get());
  if (found == waiting_.end()) {
    return;
  }
  std::vector<Waiting> waiting = std::move(found->second);
  waiting_.erase(found);
  Refuse(std::move(waiting));
}

void PrivateSessions::Refuse(std::vector<Waiting> waiting) {
  for (Waiting& entry : waiting) {
    std::move(entry.opened).Run(nullptr);
  }
}

}
