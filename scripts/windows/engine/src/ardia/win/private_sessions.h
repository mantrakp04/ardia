#ifndef ARDIA_WIN_PRIVATE_SESSIONS_H_
#define ARDIA_WIN_PRIVATE_SESSIONS_H_

#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"

class Profile;

namespace ardia_win {

class PrivateSessions {
 public:
  using Opened = base::OnceCallback<void(Profile*)>;

  struct Waiting {
    Waiting(std::string name, base::WeakPtr<Profile> original, Opened opened);
    Waiting(Waiting&&);
    Waiting& operator=(Waiting&&);
    ~Waiting();

    std::string name;
    base::WeakPtr<Profile> original;
    Opened opened;
  };

  class Session;

  PrivateSessions(const PrivateSessions&) = delete;
  PrivateSessions& operator=(const PrivateSessions&) = delete;

  static PrivateSessions* Get();
  static bool IsPrivateName(std::string_view name);

  void Open(const std::string& name, Profile* original, Opened opened);
  void Release(const std::string& name);
  int SessionNumber(Profile* profile) const;
  int LiveSessions() const;

  void SessionGone(Session* session, std::vector<Waiting> waiting);

 private:
  friend class base::NoDestructor<PrivateSessions>;

  PrivateSessions();
  ~PrivateSessions();

  void End(Session* session);
  void Resume(std::vector<Waiting> waiting);
  void Overdue(base::WeakPtr<Profile> profile);
  static void Refuse(std::vector<Waiting> waiting);

  std::set<Session*> sessions_;
  std::set<std::string> released_;
  base::WeakPtrFactory<PrivateSessions> weak_factory_{this};
};

}

#endif
