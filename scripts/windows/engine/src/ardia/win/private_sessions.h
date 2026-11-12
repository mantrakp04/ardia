#ifndef ARDIA_WIN_PRIVATE_SESSIONS_H_
#define ARDIA_WIN_PRIVATE_SESSIONS_H_

#include <map>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_multi_source_observation.h"
#include "chrome/browser/profiles/profile_observer.h"

class Profile;

namespace ardia_win {

class PrivateSessions : public ProfileObserver {
 public:
  using Opened = base::OnceCallback<void(Profile*)>;

  PrivateSessions(const PrivateSessions&) = delete;
  PrivateSessions& operator=(const PrivateSessions&) = delete;

  static PrivateSessions* Get();
  static bool IsPrivateName(std::string_view name);

  void Open(const std::string& name, Profile* original, Opened opened);
  void Release(const std::string& name);
  int SessionNumber(Profile* profile) const;
  int LiveSessions() const;

  void OnProfileWillBeDestroyed(Profile* profile) override;

 private:
  friend class base::NoDestructor<PrivateSessions>;

  struct Waiting {
    Waiting(std::string name, base::WeakPtr<Profile> original, Opened opened);
    Waiting(Waiting&&);
    Waiting& operator=(Waiting&&);
    ~Waiting();

    std::string name;
    base::WeakPtr<Profile> original;
    Opened opened;
  };

  PrivateSessions();
  ~PrivateSessions() override;

  void End(Profile* session);
  void Resume(std::vector<Waiting> waiting);
  void Overdue(base::WeakPtr<Profile> session);
  void Refuse(std::vector<Waiting> waiting);

  std::map<Profile*, std::set<std::string>> names_;
  std::map<Profile*, int> numbers_;
  std::map<Profile*, std::vector<Waiting>> waiting_;
  std::set<Profile*> ending_;
  std::set<std::string> released_;
  int next_number_ = 1;
  base::ScopedMultiSourceObservation<Profile, ProfileObserver> observed_{this};
  base::WeakPtrFactory<PrivateSessions> weak_factory_{this};
};

}

#endif
