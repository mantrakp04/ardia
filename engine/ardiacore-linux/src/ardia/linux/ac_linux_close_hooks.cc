#include "ardia/linux/ac_linux_close_hooks.h"

#include <map>
#include <memory>
#include <set>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"

namespace ardia {
namespace {

constexpr auto kMaxRetiredCloseAttempts = 1024u;

struct Pending {
  bool active = true;
  bool in_hook = true;
  bool retry = false;
  bool admitting = false;
  bool replied_in_hook = false;
  bool reply = false;
  base::RepeatingCallback<bool()> preflight;
  std::vector<base::OnceCallback<void(bool)>> continuations;
};

struct Client {
  base::RepeatingClosure discard;
  scoped_refptr<base::SingleThreadTaskRunner> runner =
      base::SingleThreadTaskRunner::GetCurrentDefault();
  base::UnguessableToken token;
  base::UnguessableToken cancelled;
  std::set<base::UnguessableToken> retired;
  bool alive = true;
  bool begun = false;
  bool cancelling = false;
  std::vector<std::weak_ptr<LinuxCloseDispatch>> dispatches;
  std::map<LinuxCloseStage, std::shared_ptr<Pending>> pending;
};

thread_local bool linux_close_sequence = false;

using Clients = std::map<BrowserWindowInterface*, std::shared_ptr<Client>>;

Clients& GetClients() {
  static base::NoDestructor<Clients> clients;
  return *clients;
}

std::shared_ptr<Client> Find(BrowserWindowInterface* browser) {
  auto it = GetClients().find(browser);
  return it == GetClients().end() ? nullptr : it->second;
}

void DiscardPending(Client& client) {
  auto pending = std::move(client.pending);
  client.pending.clear();
  for (auto& [stage, request] : pending) {
    request->active = false;
    request->continuations.clear();
  }
}

void Resolve(std::shared_ptr<Client> client,
             std::shared_ptr<Pending> pending,
             LinuxCloseStage stage,
             bool proceed,
             bool require_token) {
  if (!client->alive || client->cancelling || !pending->active) {
    return;
  }
  pending->active = false;
  client->pending.erase(stage);
  if (proceed && require_token && client->token.is_empty()) {
    proceed = false;
  }
  if (proceed && !client->token.is_empty() &&
      stage != LinuxCloseStage::kPrepare && !client->begun && !pending->retry) {
    proceed = false;
  }
  auto continuations = std::move(pending->continuations);
  const auto token = client->token;
  for (auto& continuation : continuations) {
    if (!client->alive || client->token != token) {
      break;
    }
    std::move(continuation).Run(proceed);
  }
}

}

struct ScopedLinuxCloseDispatch::Context {
  BrowserWindowInterface* browser;
  std::shared_ptr<LinuxCloseDispatch>* result;
  base::RepeatingCallback<bool()> current;
  base::RepeatingClosure ready;
  Context* previous;
};

namespace {
thread_local ScopedLinuxCloseDispatch::Context* dispatch_context = nullptr;
}

ScopedLinuxCloseDispatch::ScopedLinuxCloseDispatch(
    BrowserWindowInterface* browser,
    std::shared_ptr<LinuxCloseDispatch>* result,
    base::RepeatingCallback<bool()> current,
    base::RepeatingClosure ready)
    : context_(std::make_unique<Context>(
          Context{browser, result, std::move(current), std::move(ready),
                  dispatch_context})) {
  dispatch_context = context_.get();
}

ScopedLinuxCloseDispatch::~ScopedLinuxCloseDispatch() {
  dispatch_context = context_->previous;
}

void AdoptLinuxCloseDispatch(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch) {
  if (!dispatch_context) {
    return;
  }
  auto* context = dispatch_context;
  *context->result = dispatch;
  if (dispatch->completed) {
    context->ready.Run();
    return;
  }
  dispatch->waiters.push_back(context->ready);
  auto client = Find(context->browser);
  if (!client || client->token.is_empty() || client->cancelling ||
      dispatch->revoked || dispatch->hosted) {
    return;
  }
  std::erase_if(client->dispatches, [](const auto& weak) {
    auto request = weak.lock();
    return !request || request->completed;
  });
  client->dispatches.push_back(dispatch);
  dispatch->hosted = true;
  dispatch->current = base::BindRepeating(
      [](std::weak_ptr<Client> weak, base::UnguessableToken token,
         base::RepeatingCallback<bool()> current) {
        auto client = weak.lock();
        return client && client->alive && !client->cancelling &&
               client->token == token && current.Run();
      },
      std::weak_ptr<Client>(client), client->token, context->current);
}

bool IsLinuxCloseDispatchCurrent(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch) {
  return !dispatch ||
         (!dispatch->completed && !dispatch->revoked &&
          (dispatch->source_current.is_null() ||
           dispatch->source_current.Run()) &&
          (!dispatch->hosted ||
           (!dispatch->current.is_null() && dispatch->current.Run())));
}

void CompleteLinuxCloseDispatch(
    const std::shared_ptr<LinuxCloseDispatch>& dispatch) {
  if (!dispatch || dispatch->completed) {
    return;
  }
  dispatch->completed = true;
  auto waiters = std::move(dispatch->waiters);
  dispatch->waiters.clear();
  for (auto& ready : waiters) {
    ready.Run();
  }
}

void RevokeLinuxCloseDispatches(BrowserWindowInterface* browser) {
  auto client = Find(browser);
  if (!client) {
    return;
  }
  auto dispatches = std::move(client->dispatches);
  client->dispatches.clear();
  for (auto& weak : dispatches) {
    if (auto dispatch = weak.lock()) {
      dispatch->revoked = true;
    }
  }
}

bool IsLinuxCloseCancellationPending(BrowserWindowInterface* browser) {
  auto client = Find(browser);
  return client && client->cancelling;
}

LinuxCloseCancellation::LinuxCloseCancellation(BrowserWindowInterface* browser)
    : browser_(browser) {
  auto client = Find(browser);
  if (!client) {
    owned_ = true;
    return;
  }
  if (client->begun || client->cancelling) {
    return;
  }
  client->cancelling = true;
  token_ = client->token;
  client_ = client;
  owned_ = true;
  DiscardPending(*client);
  RevokeLinuxCloseDispatches(browser);
}

LinuxCloseCancellation::~LinuxCloseCancellation() {
  if (!owned_ || !client_) {
    return;
  }
  auto client = std::static_pointer_cast<Client>(client_);
  if (client->alive && Find(browser_) == client) {
    FinishLinuxCloseCancellation(browser_, token_);
  }
  client->cancelling = false;
}

LinuxCloseCancellation::operator bool() const {
  return owned_;
}

LinuxCloseDispatchCompletion::LinuxCloseDispatchCompletion(
    std::shared_ptr<LinuxCloseDispatch> dispatch)
    : dispatch_(std::move(dispatch)) {}
LinuxCloseDispatchCompletion::~LinuxCloseDispatchCompletion() {
  CompleteLinuxCloseDispatch(dispatch_);
}

LinuxCloseHooks g_ardia_linux_close_hooks = {};

namespace {
bool linux_quit_asks_about_downloads = false;
}

void SetLinuxQuitAsksAboutDownloads(bool asks) {
  linux_quit_asks_about_downloads = asks;
}

bool LinuxQuitAsksAboutDownloads() {
  return linux_quit_asks_about_downloads;
}

void RegisterLinuxCloseClient(BrowserWindowInterface* browser,
                              base::RepeatingClosure discard_chrome) {
  linux_close_sequence = true;
  CHECK(browser);
  CHECK(discard_chrome);
  CHECK(!Find(browser));
  auto client = std::make_shared<Client>();
  client->discard = std::move(discard_chrome);
  GetClients().emplace(browser, std::move(client));
}

void UnregisterLinuxCloseClient(BrowserWindowInterface* browser) {
  auto client = Find(browser);
  if (!client) {
    return;
  }
  RevokeLinuxCloseDispatches(browser);
  GetClients().erase(browser);
  client->alive = false;
  client->discard.Reset();
  auto pending = std::move(client->pending);
  for (auto& [stage, request] : pending) {
    request->active = false;
    for (auto& continuation : request->continuations) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(std::move(continuation), false));
    }
    request->continuations.clear();
  }
}

bool BindLinuxCloseAttempt(BrowserWindowInterface* browser,
                           const base::UnguessableToken& token) {
  auto client = Find(browser);
  if (!client || token.is_empty() || client->begun || client->cancelling ||
      (!client->token.is_empty() && client->token != token) ||
      client->retired.contains(token) ||
      (client->token.is_empty() &&
       client->retired.size() >= kMaxRetiredCloseAttempts)) {
    return false;
  }
  client->token = token;
  return true;
}

bool CancelLinuxCloseAttempt(BrowserWindowInterface* browser,
                             const base::UnguessableToken& token) {
  const auto attempt = token;
  auto client = Find(browser);
  if (!client || attempt.is_empty() || client->begun) {
    return false;
  }
  if (client->token.is_empty()) {
    return client->cancelled == attempt;
  }
  if (client->token != attempt) {
    return false;
  }
  auto discard = client->discard;
  discard.Run();
  return client->alive && client->token.is_empty() &&
         client->cancelled == attempt;
}

base::UnguessableToken CurrentLinuxCloseToken(BrowserWindowInterface* browser) {
  auto client = Find(browser);
  return client ? client->token : base::UnguessableToken();
}

bool CanCancelLinuxClose(BrowserWindowInterface* browser) {
  auto client = Find(browser);
  return !client || !client->begun;
}

void FinishLinuxCloseCancellation(BrowserWindowInterface* browser,
                                  const base::UnguessableToken& token) {
  auto client = Find(browser);
  if (!client || token.is_empty() || client->token != token || client->begun) {
    return;
  }
  DiscardPending(*client);
  client->cancelled = token;
  client->retired.insert(token);
  client->token = base::UnguessableToken();
  if (g_ardia_linux_close_hooks.cancel) {
    g_ardia_linux_close_hooks.cancel(browser, token);
  }
}

LinuxCloseAdmission CommitLinuxCloseTeardown(
    BrowserWindowInterface* browser,
    const base::UnguessableToken& token,
    LinuxCloseStage stage,
    base::OnceCallback<bool()> native_commit) {
  if (stage == LinuxCloseStage::kPrepare || !linux_close_sequence) {
    return LinuxCloseAdmission::kRejected;
  }
  const auto attempt = token;
  auto client = Find(browser);
  if (!client || !client->runner->RunsTasksInCurrentSequence() ||
      !client->alive || client->cancelling || attempt.is_empty() ||
      client->token != attempt) {
    return LinuxCloseAdmission::kRejected;
  }
  if (client->begun) {
    return LinuxCloseAdmission::kCommitted;
  }
  auto it = client->pending.find(stage);
  if (it == client->pending.end() || !it->second->active) {
    return LinuxCloseAdmission::kRejected;
  }
  const auto pending = it->second;
  if (pending->admitting) {
    return LinuxCloseAdmission::kRejected;
  }
  pending->admitting = true;
  struct AdmissionScope {
    std::shared_ptr<Pending> pending;
    ~AdmissionScope() { pending->admitting = false; }
  } scope{pending};
  const auto current = [&] {
    const auto found = client->pending.find(stage);
    return client->alive && Find(browser) == client && !client->cancelling &&
           client->token == attempt && pending->active &&
           found != client->pending.end() && found->second == pending;
  };
  auto validator = pending->preflight;
  if (validator.is_null()) {
    return LinuxCloseAdmission::kRejected;
  }
  const bool ready = validator.Run();
  if (!current()) {
    return LinuxCloseAdmission::kRejected;
  }
  if (!ready) {
    pending->retry = true;
    return LinuxCloseAdmission::kRetryPreflight;
  }
  const bool committed = std::move(native_commit).Run();
  if (!current() || !committed) {
    return LinuxCloseAdmission::kRejected;
  }
  client->begun = true;
  pending->retry = false;
  return LinuxCloseAdmission::kCommitted;
}

bool GateLinuxClose(BrowserWindowInterface* browser,
                    LinuxCloseStage stage,
                    base::OnceCallback<void(bool)> continuation,
                    base::RepeatingCallback<bool()> preflight) {
  if (!g_ardia_linux_close_hooks.defer) {
    return false;
  }
  auto client = Find(browser);
  CHECK(client);
  if (client->cancelling) {
    return true;
  }
  auto it = client->pending.find(stage);
  if (it != client->pending.end()) {
    it->second->continuations.push_back(std::move(continuation));
    return true;
  }
  auto pending = std::make_shared<Pending>();
  pending->preflight = std::move(preflight);
  pending->continuations.push_back(std::move(continuation));
  client->pending.emplace(stage, pending);
  const auto token = client->token;
  const auto cancelled = client->cancelled;
  bool deferred = g_ardia_linux_close_hooks.defer(
      browser, token, stage,
      base::BindOnce(
          [](scoped_refptr<base::SingleThreadTaskRunner> runner,
             std::shared_ptr<Client> client, std::shared_ptr<Pending> pending,
             LinuxCloseStage stage, bool proceed) {
            if (runner->RunsTasksInCurrentSequence() && pending->in_hook) {
              pending->replied_in_hook = true;
              pending->reply = proceed;
              return;
            }
            if (stage != LinuxCloseStage::kPrepare &&
                runner->RunsTasksInCurrentSequence()) {
              Resolve(std::move(client), std::move(pending), stage, proceed,
                      true);
              return;
            }
            runner->PostTask(
                FROM_HERE,
                base::BindOnce(&Resolve, std::move(client), std::move(pending),
                               stage, proceed, true));
          },
          base::SingleThreadTaskRunner::GetCurrentDefault(), client, pending,
          stage));
  pending->in_hook = false;
  if (!client->alive || client->cancelled != cancelled) {
    return true;
  }
  if (pending->replied_in_hook) {
    if (stage != LinuxCloseStage::kPrepare && client->begun) {
      Resolve(client, pending, stage, pending->reply, true);
    } else {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(&Resolve, client, pending, stage,
                                    pending->reply, true));
    }
    return true;
  }
  if (!deferred && !client->token.is_empty() &&
      stage != LinuxCloseStage::kPrepare && !client->begun) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&Resolve, client, pending, stage,
                                  pending->retry, true));
    return true;
  }
  if (!deferred) {
    pending->continuations.erase(pending->continuations.begin());
    if (pending->continuations.empty()) {
      pending->active = false;
      client->pending.erase(stage);
    } else if (stage == LinuxCloseStage::kPrepare ||
               client->token.is_empty()) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(&Resolve, client, pending, stage, true, false));
    } else {
      Resolve(client, pending, stage, true, false);
    }
  }
  return deferred;
}

}
