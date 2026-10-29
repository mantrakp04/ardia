#include <cassert>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_dialogs.h"

using namespace ardia;

base::DictValue Request(const std::string& id, bool prompt = false,
                        std::string owner = "a") {
  base::DictValue options;
  options.Set("title", "Title");
  options.Set("message", "Message");
  options.Set("confirmTitle", "Delete Profile");
  options.Set("windowId", owner);
  if (!prompt) {
    options.Set("destructive", true);
    options.Set("cancelTitle", "Keep Profile");
    options.Set("suppression", "Don’t ask me again");
  } else {
    options.Set("value", "Old name");
    options.Set("placeholder", "New name");
  }
  base::DictValue request;
  request.Set("dialogId", id);
  request.Set("kind", prompt ? "prompt" : "confirm");
  request.Set("options", std::move(options));
  return request;
}

struct Surface : LinuxDialogSurface {
  int* closed;
  explicit Surface(int* value) : closed(value) {}
  ~Surface() override { ++*closed; }
};
struct Fixture {
  int closed = 0;
  std::vector<LinuxDialogSpec> shown;
  std::vector<LinuxDialogResponder> responders;
  std::vector<base::DictValue> results;
  LinuxDialogClient client{"a", "default", "9007199254740993", true, true};
  std::unique_ptr<LinuxDialogController> controller;
  explicit Fixture(std::string window = "a") {
    client.window_id = window;
    controller = std::make_unique<LinuxDialogController>(window, "default",
        [&](const auto& spec, LinuxDialogResponder done) -> std::unique_ptr<LinuxDialogSurface> {
          shown.push_back(spec);
          responders.push_back(std::move(done));
          return std::make_unique<Surface>(&closed);
        });
    assert(controller->ReplaceRenderer(client.renderer_generation));
  }
  bool Begin(const std::string& id, bool prompt = false) {
    std::string error;
    return controller->Begin(client, Request(id, prompt, client.window_id),
        [&](auto value) { results.push_back(std::move(value)); }, &error);
  }
  const base::Value& Result(size_t index) const {
    return *results[index].FindDict("data")->Find("result");
  }
};

void QueueAndResults() {
  Fixture f;
  assert(f.Begin("dialog:identity-0001"));
  assert(f.Begin("dialog:identity-0002", true));
  assert(f.shown.size() == 1);
  assert(f.shown[0].title == "Title" && f.shown[0].message == "Message");
  assert(f.shown[0].destructive && f.shown[0].confirm_title == "Delete Profile");
  assert(f.shown[0].cancel_title == "Keep Profile");
  assert(!f.Begin("dialog:identity-0001"));
  std::move(f.responders[0]).Run({false, true, "ignored", false});
  assert(f.closed == 1 && f.controller->pending() == 1 && f.shown.size() == 2);
  assert(!f.Result(0).GetDict().Find("confirmed")->GetBool());
  assert(f.Result(0).GetDict().Find("suppressed")->GetBool());
  assert(*f.results[0].FindDict("data")->FindString("rendererGeneration") == "9007199254740993");
  assert(f.shown[1].value == "Old name" && f.shown[1].placeholder == "New name");
  std::move(f.responders[1]).Run({true, false, " \tRenamed\n", false});
  assert(f.Result(1).GetString() == "Renamed");
  assert(f.controller->pending() == 0 && f.closed == 2);
  assert(f.controller->Cancel(f.client, "dialog:identity-0001"));
  assert(f.results.size() == 2);
  assert(f.Begin("dialog:identity-0003", true));
  std::move(f.responders[2]).Run({true, false, " \t\n", false});
  assert(f.Result(2).is_none());
  assert(f.Begin("dialog:identity-0004", true));
  std::move(f.responders[3]).Run({false, false, "value", false});
  assert(f.Result(3).is_none());
}

void AuthorizationAndBounds() {
  Fixture f, other;
  other.client.window_id = "b";
  other.controller = std::make_unique<LinuxDialogController>("b", "default",
      [&](const auto&, LinuxDialogResponder done) -> std::unique_ptr<LinuxDialogSurface> {
        other.responders.push_back(std::move(done));
        return std::make_unique<Surface>(&other.closed);
      });
  assert(other.controller->ReplaceRenderer(other.client.renderer_generation));
  std::string error;
  auto no = [](auto) { assert(false); };
  for (int i = 0; i < 5; ++i) {
    auto client = f.client;
    if (i == 0) client.authenticated_shell = false;
    if (i == 1) client.default_regular_profile = false;
    if (i == 2) client.profile_identity = "wrong-profile";
    if (i == 3) client.window_id = "b";
    if (i == 4) client.renderer_generation = "9007199254740992";
    assert(!f.controller->Begin(client, Request("dialog:identity-0001"), no, &error));
    assert(!f.controller->Cancel(client, "dialog:identity-0001"));
  }
  assert(!f.controller->Begin(f.client, Request("dialog:identity-0001", false, "b"), no, &error));
  for (int i = 0; i < 16; ++i) assert(f.Begin("dialog:queue-identity-" + std::to_string(i)));
  assert(!f.Begin("dialog:queue-identity-overflow"));
  assert(other.controller->Begin(other.client, Request("dialog:identity-0001", false, "b"),
      [&](auto value) { other.results.push_back(std::move(value)); }, &error));
  assert(other.results.empty());
  f.controller->ParentDestroyed();
  assert(f.results.size() == 16 && f.controller->pending() == 0);
  for (size_t i = 0; i < f.results.size(); ++i) {
    assert(!f.Result(i).GetDict().Find("confirmed")->GetBool());
    assert(!f.Result(i).GetDict().Find("suppressed")->GetBool());
  }
  assert(!f.Begin("dialog:after-parent-death"));
  std::move(other.responders[0]).Run({true, true, "", false});
  assert(other.Result(0).GetDict().Find("confirmed")->GetBool());
}

void RetirementAndStaleCallbacks() {
  Fixture f;
  assert(f.Begin("dialog:identity-0001"));
  auto stale = std::move(f.responders[0]);
  f.controller->RetireRenderer("9007199254740992");
  assert(f.controller->pending() == 1);
  f.controller->RetireRenderer(f.client.renderer_generation);
  assert(f.controller->pending() == 0 && f.results.size() == 1);
  assert(!f.controller->ReplaceRenderer(f.client.renderer_generation));
  f.client.renderer_generation = "9007199254740994";
  assert(f.controller->ReplaceRenderer(f.client.renderer_generation));
  assert(f.Begin("dialog:identity-0001"));
  std::move(stale).Run({true, true, "", false});
  assert(f.results.size() == 1 && f.controller->pending() == 1);
  assert(f.controller->Cancel(f.client, "dialog:identity-0001"));
  std::move(f.responders[1]).Run({true, true, "", false});
  assert(f.results.size() == 2 && !f.Result(1).GetDict().Find("confirmed")->GetBool());
  assert(f.Begin("dialog:identity-0002"));
  auto after_destruction = std::move(f.responders[2]);
  f.controller.reset();
  assert(f.results.size() == 3);
  std::move(after_destruction).Run({true, true, "", false});
  assert(f.results.size() == 3);
}

void ReplacementCancelsBeforePublication() {
  Fixture f;
  std::string error;
  int canceled = 0;
  const auto next = "9007199254740994";
  for (const auto* id : {"dialog:replacement-1", "dialog:replacement-2"}) {
    assert(f.controller->Begin(f.client, Request(id), [&](auto value) {
      ++canceled;
      assert(f.closed == 1);
      auto incoming = f.client;
      incoming.renderer_generation = next;
      assert(!f.controller->Begin(incoming, Request("dialog:new-generation"), [](auto) {}, &error));
      assert(!value.FindDict("data")->FindDict("result")->Find("suppressed")->GetBool());
    }, &error));
  }
  assert(f.controller->ReplaceRenderer(next));
  assert(canceled == 2 && f.controller->pending() == 0 && f.closed == 1);
  f.client.renderer_generation = next;
  assert(f.Begin("dialog:new-generation"));
  std::move(f.responders[0]).Run({true, true, "", false});
  assert(f.controller->pending() == 1 && f.results.empty());
}

void RetiredGenerationsCannotReturn() {
  Fixture f;
  const auto old = f.client;
  assert(f.controller->ReplaceRenderer("9007199254740994"));
  assert(!f.controller->ReplaceRenderer(old.renderer_generation));
  std::string error;
  assert(!f.controller->Begin(old, Request("dialog:retired-direct"), [](auto) {}, &error));
  assert(f.controller->ReplaceRenderer("9007199254740995"));
  assert(!f.controller->ReplaceRenderer(old.renderer_generation));
  assert(!f.controller->ReplaceRenderer("9007199254740994"));
  f.controller->RetireRenderer("9007199254740995");
  assert(!f.controller->ReplaceRenderer(old.renderer_generation));
  assert(!f.controller->ReplaceRenderer("9007199254740995"));
  assert(f.controller->ReplaceRenderer("9007199254740996"));
  f.client.renderer_generation = "9007199254740996";
  assert(f.Begin("dialog:current-after-retirement"));
  assert(!f.controller->Cancel(old, "dialog:current-after-retirement"));
  assert(f.controller->pending() == 1);
}

void RendererHistoryExhaustion() {
  Fixture f;
  for (size_t i = 1; i <= LinuxDialogController::kMaxRetiredGenerations; ++i) {
    assert(f.controller->ReplaceRenderer(std::to_string(i)));
  }
  f.client.renderer_generation = std::to_string(LinuxDialogController::kMaxRetiredGenerations);
  assert(f.Begin("dialog:before-history-exhaustion"));
  assert(!f.controller->ReplaceRenderer(std::to_string(LinuxDialogController::kMaxRetiredGenerations + 1)));
  assert(f.controller->pending() == 0 && f.results.size() == 1);
  assert(!f.Begin("dialog:after-history-exhaustion"));
  assert(!f.controller->ReplaceRenderer(f.client.renderer_generation));
}

void ReentrantCompletionAndDestruction() {
  Fixture f;
  std::string error;
  assert(f.controller->Begin(f.client, Request("dialog:identity-0001"), [&](auto result) {
    assert(f.controller->pending() == 0 && f.closed == 1);
    assert(f.Begin("dialog:identity-0002"));
    assert(f.shown.size() == 1);
    f.results.push_back(std::move(result));
  }, &error));
  std::move(f.responders[0]).Run({true, true, "", false});
  assert(f.shown.size() == 2);
  f.controller->ParentDestroyed();
  Fixture destroyed;
  assert(destroyed.controller->Begin(destroyed.client, Request("dialog:identity-0001"),
      [&](auto) { destroyed.controller.reset(); }, &error));
  std::move(destroyed.responders[0]).Run({false, false, "", false});
  assert(!destroyed.controller);
  Fixture retired;
  assert(retired.controller->Begin(retired.client, Request("dialog:identity-0001"), [&](auto) {
    assert(!retired.controller->ReplaceRenderer("9007199254740995"));
    assert(!retired.Begin("dialog:reentrant-identity"));
  }, &error));
  retired.controller->RetireRenderer(retired.client.renderer_generation);
}

void InvalidRequestsAndOptionalOwner() {
  Fixture f;
  std::string error;
  auto no = [](auto) { assert(false); };
  for (int variant = 0; variant < 6; ++variant) {
    auto request = Request("dialog:request-identity");
    if (variant == 0) request.Set("dialogId", "short");
    if (variant == 1) request.Set("kind", "alert");
    if (variant == 2) request.Set("options", base::Value());
    if (variant >= 3) {
      auto options = request.FindDict("options")->Clone();
      if (variant == 3) options.Set("windowId", base::Value());
      if (variant == 4) options.Set("message", std::string(16385, 'x'));
      if (variant == 5) options.Set("destructive", "yes");
      request.Set("options", std::move(options));
    }
    assert(!f.controller->Begin(f.client, request, no, &error));
  }
  base::DictValue options;
  options.Set("title", "Prompt");
  base::DictValue request;
  request.Set("dialogId", "dialog:optional-owner");
  request.Set("kind", "prompt");
  request.Set("options", std::move(options));
  assert(f.controller->Begin(f.client, request, [&](auto result) { f.results.push_back(std::move(result)); }, &error));
  std::move(f.responders[0]).Run({true, false, "\xe2\x80\x83 Unicode \xe2\x80\x83", false});
  assert(f.Result(0).GetString() == "Unicode");
}

void SynchronousPresenterAndFailure() {
  for (bool respond : {false, true}) {
    int closed = 0, completed = 0;
    LinuxDialogController controller("a", "default",
        [&](const auto&, LinuxDialogResponder done) -> std::unique_ptr<LinuxDialogSurface> {
          if (respond) std::move(done).Run({true, false, "", false});
          return respond ? std::make_unique<Surface>(&closed) : nullptr;
        });
    assert(controller.ReplaceRenderer("1"));
    std::string error;
    assert(controller.Begin({"a", "default", "1", true, true}, Request("dialog:sync-identity"),
        [&](auto value) {
          ++completed;
          assert(value.FindDict("data")->FindDict("result")->Find("confirmed")->GetBool() == respond);
        }, &error));
    assert(completed == 1 && controller.pending() == 0);
    assert(closed == static_cast<int>(respond));
  }
  std::unique_ptr<LinuxDialogController> destroyed;
  int closed = 0;
  auto keep_alive = std::make_shared<int>(42);
  destroyed = std::make_unique<LinuxDialogController>("a", "default",
      [&, keep_alive](const auto&, LinuxDialogResponder done) -> std::unique_ptr<LinuxDialogSurface> {
        std::move(done).Run({false, false, "", false});
        assert(*keep_alive == 42);
        return std::make_unique<Surface>(&closed);
      });
  keep_alive.reset();
  assert(destroyed->ReplaceRenderer("1"));
  std::string error;
  assert(destroyed->Begin({"a", "default", "1", true, true}, Request("dialog:sync-destruction"),
      [&](auto) { destroyed.reset(); }, &error));
  assert(!destroyed && closed == 1);
}

void TwoWindowsSuspendIndependently() {
  Fixture a, b("b");
  assert(a.Begin("dialog:window-a-0001"));
  assert(a.Begin("dialog:window-a-0002", true));
  assert(b.Begin("dialog:window-b-0001"));
  auto stale = std::move(a.responders[0]);
  const auto suspension = a.controller->Suspend();
  assert(suspension && a.controller->suspended() && !b.controller->suspended());
  assert(a.results.size() == 2 && a.controller->pending() == 0 && a.closed == 1 && a.shown.size() == 1);
  assert(!a.Result(0).GetDict().Find("confirmed")->GetBool());
  assert(!a.Result(0).GetDict().Find("suppressed")->GetBool());
  assert(a.Result(1).is_none());
  assert(b.controller->pending() == 1 && b.results.empty() && b.closed == 0);
  base::DictValue identity;
  assert(!a.controller->Identify(a.client, &identity) && !identity.Find("windowId"));
  assert(b.controller->Identify(b.client, &identity));
  assert(*identity.FindString("windowId") == "b");
  assert(*identity.FindString("rendererGeneration") == b.client.renderer_generation);
  std::string error;
  assert(!a.controller->Begin(a.client, Request("dialog:window-a-0003"), [](auto) { assert(false); }, &error));
  assert(error == "Dialogs are suspended for this window");
  assert(a.controller->Cancel(a.client, "dialog:window-a-0001"));
  std::move(stale).Run({true, true, "", false});
  assert(a.results.size() == 2);
  assert(!b.controller->Resume(suspension) && a.controller->suspended());
  std::move(b.responders[0]).Run({true, true, "", false});
  assert(b.results.size() == 1 && b.Result(0).GetDict().Find("confirmed")->GetBool());
  assert(a.controller->Resume(suspension) && !a.controller->suspended());
  assert(a.Begin("dialog:window-a-0003") && a.shown.size() == 2);
}

void QueuedWarningsCancelOncePerDialog() {
  Fixture f;
  std::map<std::string, int> completions;
  std::string error;
  for (const auto* id : {"dialog:close-warning-1", "dialog:close-warning-2", "dialog:close-warning-3"}) {
    assert(f.controller->Begin(f.client, Request(id), [&](base::DictValue value) {
      const auto* data = value.FindDict("data");
      assert(!data->FindDict("result")->Find("confirmed")->GetBool());
      assert(!data->FindDict("result")->Find("suppressed")->GetBool());
      ++completions[*data->FindString("dialogId")];
    }, &error));
  }
  assert(f.shown.size() == 1);
  auto active = std::move(f.responders[0]);
  const auto suspension = f.controller->Suspend();
  assert(completions.size() == 3 && f.shown.size() == 1 && f.closed == 1);
  for (const auto& [id, count] : completions) assert(count == 1);
  std::move(active).Run({true, true, "", false});
  const auto again = f.controller->Suspend();
  assert(completions.size() == 3);
  for (const auto& [id, count] : completions) assert(count == 1);
  assert(f.controller->Resume(suspension) && f.controller->suspended());
  assert(f.controller->Resume(again) && !f.controller->suspended());
}

void OverlappingSuspensionsReleaseIndependently() {
  Fixture f, other;
  const auto first = f.controller->Suspend();
  const auto second = f.controller->Suspend();
  assert(first && second && !(first == second));
  assert(!f.controller->Resume(LinuxDialogSuspension()));
  const auto foreign = other.controller->Suspend();
  assert(!f.controller->Resume(foreign) && !other.controller->Resume(second));
  assert(f.controller->Resume(second) && !f.controller->Resume(second));
  assert(f.controller->suspended() && !f.Begin("dialog:first-still-outstanding"));
  base::DictValue identity;
  assert(!f.controller->Identify(f.client, &identity));
  assert(f.controller->Resume(first) && !f.controller->Resume(first));
  assert(!f.controller->suspended());
  assert(f.Begin("dialog:resumed-identity") && f.shown.size() == 1);
  assert(other.controller->Resume(foreign));
}

void NestedResumeKeepsOuterSuspension() {
  Fixture f;
  std::string error;
  assert(f.controller->Begin(f.client, Request("dialog:nested-resume-1"), [&](auto) {
    const auto inner = f.controller->Suspend();
    assert(f.controller->Resume(inner));
  }, &error));
  const auto outer = f.controller->Suspend();
  assert(outer && f.controller->suspended());
  assert(!f.Begin("dialog:nested-resume-admission") && f.shown.size() == 1);
  assert(f.controller->Resume(outer) && !f.controller->suspended());
}

void SuspensionBoundFailsClosed() {
  Fixture f;
  std::vector<LinuxDialogSuspension> held;
  for (size_t i = 0; i < LinuxDialogController::kMaxSuspensions; ++i) {
    held.push_back(f.controller->Suspend());
    assert(held.back());
  }
  const auto overflow = f.controller->Suspend();
  assert(!overflow && f.controller->suspended());
  for (const auto& suspension : held) assert(f.controller->Resume(suspension));
  assert(!f.controller->Resume(overflow));
  assert(f.controller->suspended() && !f.Begin("dialog:after-suspension-overflow"));
}

void ReplacementDuringSuspension() {
  Fixture f;
  assert(f.Begin("dialog:before-replacement"));
  const auto suspension = f.controller->Suspend();
  const auto old = f.client;
  assert(f.controller->ReplaceRenderer("9007199254740994"));
  f.client.renderer_generation = "9007199254740994";
  assert(f.controller->suspended() && f.results.size() == 1);
  assert(!f.Begin("dialog:during-replacement"));
  base::DictValue identity;
  assert(!f.controller->Identify(f.client, &identity));
  assert(f.controller->Resume(suspension));
  assert(!f.controller->Identify(old, &identity));
  assert(f.controller->Identify(f.client, &identity));
  assert(*identity.FindString("rendererGeneration") == "9007199254740994");
  assert(f.Begin("dialog:after-replacement"));
  assert(!f.controller->ReplaceRenderer(old.renderer_generation));
  assert(f.results.size() == 1 && f.controller->pending() == 1);
}

void ParentDestructionAndTeardownWhileSuspended() {
  Fixture f;
  assert(f.Begin("dialog:parent-suspended"));
  const auto suspension = f.controller->Suspend();
  f.controller->ParentDestroyed();
  assert(f.results.size() == 1);
  assert(f.controller->Resume(suspension));
  assert(!f.Begin("dialog:after-parent-suspended"));
  base::DictValue identity;
  assert(!f.controller->Identify(f.client, &identity));
  Fixture torn;
  assert(torn.Begin("dialog:teardown-suspended"));
  auto stale = std::move(torn.responders[0]);
  torn.controller->Suspend();
  assert(torn.results.size() == 1);
  torn.controller.reset();
  assert(torn.results.size() == 1);
  std::move(stale).Run({true, true, "", false});
  assert(torn.results.size() == 1);
}

void ReentrantSuspension() {
  Fixture f;
  std::string error;
  LinuxDialogSuspension nested;
  int completions = 0;
  assert(f.controller->Begin(f.client, Request("dialog:reentrant-suspend-1"), [&](auto) {
    ++completions;
    assert(!f.Begin("dialog:reentrant-admission"));
    base::DictValue identity;
    assert(!f.controller->Identify(f.client, &identity));
    nested = f.controller->Suspend();
  }, &error));
  assert(f.controller->Begin(f.client, Request("dialog:reentrant-suspend-2"), [&](auto) { ++completions; }, &error));
  const auto outer = f.controller->Suspend();
  assert(completions == 2 && f.controller->pending() == 0 && f.shown.size() == 1);
  assert(nested && !(nested == outer));
  assert(f.controller->Resume(nested) && f.controller->suspended());
  assert(f.controller->Resume(outer) && !f.controller->suspended());
  Fixture destroyed;
  assert(destroyed.controller->Begin(destroyed.client, Request("dialog:destroy-in-suspend-1"),
      [&](auto) { destroyed.controller.reset(); }, &error));
  assert(destroyed.Begin("dialog:destroy-in-suspend-2"));
  auto* raw = destroyed.controller.get();
  const auto token = raw->Suspend();
  assert(!destroyed.controller && token && destroyed.results.size() == 1);
}

void SuspensionKeepsRetirementHistory() {
  Fixture f;
  for (int i = 0; i < 3000; ++i) assert(f.controller->Resume(f.controller->Suspend()));
  assert(f.Begin("dialog:after-suspend-cycles") && f.results.empty());
  for (size_t i = 1; i <= LinuxDialogController::kMaxRetiredGenerations; ++i) {
    const auto suspension = f.controller->Suspend();
    assert(f.controller->ReplaceRenderer(std::to_string(i)));
    assert(f.controller->Resume(suspension));
  }
  f.client.renderer_generation = std::to_string(LinuxDialogController::kMaxRetiredGenerations);
  assert(f.Begin("dialog:before-history-exhaustion"));
  assert(!f.controller->ReplaceRenderer(std::to_string(LinuxDialogController::kMaxRetiredGenerations + 1)));
  assert(f.controller->pending() == 0);
  assert(f.controller->Resume(f.controller->Suspend()));
  assert(!f.Begin("dialog:after-history-exhaustion"));
  assert(!f.controller->ReplaceRenderer(f.client.renderer_generation));
}

int main() {
  QueueAndResults();
  AuthorizationAndBounds();
  RetirementAndStaleCallbacks();
  ReplacementCancelsBeforePublication();
  RetiredGenerationsCannotReturn();
  RendererHistoryExhaustion();
  ReentrantCompletionAndDestruction();
  SynchronousPresenterAndFailure();
  InvalidRequestsAndOptionalOwner();
  TwoWindowsSuspendIndependently();
  QueuedWarningsCancelOncePerDialog();
  OverlappingSuspensionsReleaseIndependently();
  NestedResumeKeepsOuterSuspension();
  SuspensionBoundFailsClosed();
  ReplacementDuringSuspension();
  ParentDestructionAndTeardownWhileSuspended();
  ReentrantSuspension();
  SuspensionKeepsRetirementHistory();
}
