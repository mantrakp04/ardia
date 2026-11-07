#ifndef ARDIA_LINUX_AC_LINUX_CLOSE_HOOKS_H_
#define ARDIA_LINUX_AC_LINUX_CLOSE_HOOKS_H_

#include <memory>
#include <vector>

#include "base/functional/callback.h"
#include "base/unguessable_token.h"

class BrowserWindowInterface;

namespace ardia {

enum class LinuxCloseStage { kPrepare, kBeginTeardown, kDestroy };

struct LinuxCloseHooks {
  bool (*defer)(BrowserWindowInterface*,
                const base::UnguessableToken&,
                LinuxCloseStage,
                base::OnceCallback<void(bool)>);
  void (*cancel)(BrowserWindowInterface*, const base::UnguessableToken&);
};

struct LinuxCloseDispatch {
  LinuxCloseDispatch() = default;
  LinuxCloseDispatch(const LinuxCloseDispatch&) = delete;
  LinuxCloseDispatch& operator=(const LinuxCloseDispatch&) = delete;
  bool hosted = false;
  bool completed = false;
  bool revoked = false;
  base::RepeatingCallback<bool()> current;
  base::RepeatingCallback<bool()> source_current;
  base::RepeatingCallback<bool()> preflight_current;
  std::vector<base::RepeatingClosure> waiters;
};

class ScopedLinuxCloseDispatch {
 public:
  ScopedLinuxCloseDispatch(BrowserWindowInterface* browser,
                           std::shared_ptr<LinuxCloseDispatch>* result,
                           base::RepeatingCallback<bool()> current,
                           base::RepeatingClosure ready);
  ~ScopedLinuxCloseDispatch();
  struct Context;

 private:
  std::unique_ptr<Context> context_;
};

class LinuxCloseCancellation {
 public:
  explicit LinuxCloseCancellation(BrowserWindowInterface* browser);
  ~LinuxCloseCancellation();
  LinuxCloseCancellation(const LinuxCloseCancellation&) = delete;
  LinuxCloseCancellation& operator=(const LinuxCloseCancellation&) = delete;
  explicit operator bool() const;

 private:
  BrowserWindowInterface* browser_;
  base::UnguessableToken token_;
  std::shared_ptr<void> client_;
  bool owned_ = false;
};

void AdoptLinuxCloseDispatch(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch);
bool IsLinuxCloseDispatchCurrent(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch);
void CompleteLinuxCloseDispatch(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch);
void RevokeLinuxCloseDispatches(BrowserWindowInterface* browser);
bool IsLinuxCloseCancellationPending(BrowserWindowInterface* browser);

class LinuxCloseDispatchCompletion {
 public:
  explicit LinuxCloseDispatchCompletion(
      std::shared_ptr<LinuxCloseDispatch> dispatch);
  ~LinuxCloseDispatchCompletion();
  LinuxCloseDispatchCompletion(const LinuxCloseDispatchCompletion&) = delete;
  LinuxCloseDispatchCompletion& operator=(const LinuxCloseDispatchCompletion&) =
      delete;

 private:
  std::shared_ptr<LinuxCloseDispatch> dispatch_;
};

extern LinuxCloseHooks g_ardia_linux_close_hooks;

void SetLinuxQuitAsksAboutDownloads(bool asks);
bool LinuxQuitAsksAboutDownloads();

void RegisterLinuxCloseClient(BrowserWindowInterface* browser,
                              base::RepeatingClosure discard_chrome);
void UnregisterLinuxCloseClient(BrowserWindowInterface* browser);
bool BindLinuxCloseAttempt(BrowserWindowInterface* browser,
                           const base::UnguessableToken& token);
bool CancelLinuxCloseAttempt(BrowserWindowInterface* browser,
                             const base::UnguessableToken& token);
base::UnguessableToken CurrentLinuxCloseToken(BrowserWindowInterface* browser);
bool CanCancelLinuxClose(BrowserWindowInterface* browser);
void FinishLinuxCloseCancellation(BrowserWindowInterface* browser,
                                  const base::UnguessableToken& token);
enum class LinuxCloseAdmission { kRejected, kRetryPreflight, kCommitted };
LinuxCloseAdmission CommitLinuxCloseTeardown(
    BrowserWindowInterface* browser,
    const base::UnguessableToken& token,
    LinuxCloseStage stage,
    base::OnceCallback<bool()> native_commit);
bool GateLinuxClose(BrowserWindowInterface* browser,
                    LinuxCloseStage stage,
                    base::OnceCallback<void(bool)> continuation,
                    base::RepeatingCallback<bool()> preflight = {});

}

#endif
