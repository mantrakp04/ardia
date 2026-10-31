#ifndef ARDIA_LINUX_AC_LINUX_DIALOGS_H_
#define ARDIA_LINUX_AC_LINUX_DIALOGS_H_

#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <string>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"

namespace ardia {

struct LinuxDialogClient {
  std::string window_id;
  std::string profile_identity;
  std::string renderer_generation;
  bool authenticated_shell = false;
  bool default_regular_profile = false;
};

struct LinuxDialogSpec {
  std::string dialog_id;
  bool prompt = false;
  std::string title;
  std::string message;
  std::string confirm_title = "OK";
  std::string cancel_title = "Cancel";
  bool destructive = false;
  bool has_suppression = false;
  std::string suppression;
  std::string value;
  std::string placeholder;
};

struct LinuxDialogResponse {
  bool accepted = false;
  bool suppressed = false;
  std::string text;
  bool forced = false;
};

class LinuxDialogSurface {
 public:
  virtual ~LinuxDialogSurface() = default;
};

using LinuxDialogResponder = base::OnceCallback<void(LinuxDialogResponse)>;
using LinuxDialogPresenter = base::RepeatingCallback<std::unique_ptr<LinuxDialogSurface>(
    const LinuxDialogSpec&, LinuxDialogResponder)>;
using LinuxDialogCompletion = base::OnceCallback<void(base::DictValue)>;

class LinuxDialogSuspension {
 public:
  LinuxDialogSuspension() = default;
  explicit operator bool() const { return value_ != 0; }
  bool operator==(const LinuxDialogSuspension&) const = default;

 private:
  friend class LinuxDialogController;
  explicit LinuxDialogSuspension(uint64_t value) : value_(value) {}
  uint64_t value_ = 0;
};

class LinuxDialogController {
 public:
  static constexpr size_t kMaxPending = 16;
  static constexpr size_t kMaxRetiredGenerations = 1024;
  static constexpr size_t kMaxSuspensions = 64;

  LinuxDialogController(std::string window_id,
                        std::string profile_identity,
                        LinuxDialogPresenter presenter);
  ~LinuxDialogController();
  LinuxDialogController(const LinuxDialogController&) = delete;
  LinuxDialogController& operator=(const LinuxDialogController&) = delete;

  bool ReplaceRenderer(const std::string& generation);
  bool Identify(const LinuxDialogClient& client, base::DictValue* identity) const;
  bool Begin(const LinuxDialogClient& client,
             const base::DictValue& request,
             LinuxDialogCompletion completion,
             std::string* error);
  bool Cancel(const LinuxDialogClient& client, const std::string& dialog_id);
  void RetireRenderer(const std::string& generation);
  void ParentDestroyed();
  LinuxDialogSuspension Suspend();
  bool Resume(const LinuxDialogSuspension& suspension);
  bool suspended() const { return suspensions_exhausted_ || !suspensions_.empty(); }
  size_t pending() const { return entries_.size(); }
  base::WeakPtr<LinuxDialogController> GetWeakPtr();

 private:
  struct Entry {
    LinuxDialogSpec spec;
    std::string generation;
    uint64_t sequence;
    LinuxDialogCompletion completion;
  };

  bool Authorized(const LinuxDialogClient& client) const;
  bool Admits(const LinuxDialogClient& client) const;
  void Pump();
  void Complete(std::string id, uint64_t sequence, LinuxDialogResponse response);
  void CancelAll();

  const std::string window_id_;
  const std::string profile_identity_;
  LinuxDialogPresenter presenter_;
  std::string generation_;
  std::set<std::string> retired_generations_;
  bool renderer_history_exhausted_ = false;
  bool parent_alive_ = true;
  bool canceling_ = false;
  bool pumping_ = false;
  uint64_t sequence_ = 0;
  uint64_t active_sequence_ = 0;
  std::set<uint64_t> suspensions_;
  bool suspensions_exhausted_ = false;
  std::map<std::string, Entry> entries_;
  std::unique_ptr<LinuxDialogSurface> surface_;
  base::WeakPtrFactory<LinuxDialogController> weak_factory_{this};
};

}

#endif
