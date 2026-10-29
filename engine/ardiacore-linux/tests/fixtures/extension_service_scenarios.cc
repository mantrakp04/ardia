#include <cassert>
#include <cstdio>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

Profile regular;
Profile isolated;
Profile incognito;
std::vector<extensions::ExtensionInstallPromptClient::Result> answers;

struct Outcome {
  bool replied = false;
  Profile* profile = nullptr;
  std::string code;
};

Outcome Resolve(const ardia::LinuxExtensionWindow& window, const std::string& name, std::string_view requested) {
  Outcome outcome;
  ardia::CallProfile(window, name, requested, base::OnceCallback<void(Profile*, std::string)>([&](Profile* profile, std::string code) {
    outcome = {true, profile, std::move(code)};
  }));
  assert(outcome.replied);
  return outcome;
}

struct Reply {
  bool ok = false;
  std::string code;
};

Reply Answer(const ardia::LinuxExtensionWindow& window, const std::string& request, bool accepted) {
  Outcome profile = Resolve(window, "extensions.resolveInstallPrompt", "");
  if (!profile.profile) return {false, profile.code};
  Reply reply;
  ardia::ResolvePrompt(window, profile.profile, base::DictValue().Set("requestId", request).Set("accepted", accepted),
                       ardia::Done([&](bool ok, base::Value value) {
                         reply.ok = ok;
                         if (const std::string* code = value.is_dict() ? value.GetDict().FindString("code") : nullptr) reply.code = *code;
                       }));
  return reply;
}

std::string Prompt(Profile* profile, int window, base::WeakPtrFactory<Profile>& weak) {
  auto request = ardia::Prompts().Add(ardia::ProfileId(profile), window, base::DictValue(),
      ardia::PendingInstall{ardia::InstallDone([](extensions::ExtensionInstallPromptClient::DoneCallbackPayload payload) {
        answers.push_back(payload.result);
      }), weak.GetWeakPtr(), nullptr});
  assert(request);
  return *request;
}

std::string PromptFor(content::WebContents* parent, Profile* profile, int window, base::WeakPtrFactory<Profile>& weak) {
  auto watch = std::make_unique<ardia::PromptParentWatch>(parent);
  auto* raw = watch.get();
  auto request = ardia::Prompts().Add(ardia::ProfileId(profile), window, base::DictValue(),
      ardia::PendingInstall{ardia::InstallDone([](extensions::ExtensionInstallPromptClient::DoneCallbackPayload payload) {
        answers.push_back(payload.result);
      }), weak.GetWeakPtr(), std::move(watch)});
  assert(request);
  raw->Track(*request);
  return *request;
}

}

int main() {
  incognito.off_the_record = true;
  incognito.original = &regular;
  ardiacore::g_profiles = {{"", &regular}, {"work", &isolated}};
  base::WeakPtrFactory<Profile> regular_weak(&regular);
  base::WeakPtrFactory<Profile> isolated_weak(&isolated);
  content::WebContents isolated_tab;
  isolated_tab.context = &isolated;
  content::WebContents regular_tab;
  regular_tab.context = &regular;

  ardia::LinuxExtensionWindow work;
  work.profile = &isolated;
  work.window = 7;
  work.tab = base::RepeatingCallback<content::WebContents*(std::string_view)>([&](std::string_view key) -> content::WebContents* {
    return key == "work-tab" ? &isolated_tab : key == "regular-tab" ? &regular_tab : nullptr;
  });

  for (const char* call : {"extensions.actionStates", "extensions.sidePanelUrl", "extensions.resolveInstallPrompt"}) {
    const Outcome outcome = Resolve(work, call, "");
    assert(outcome.profile == &isolated && outcome.code.empty());
  }
  assert(Resolve(work, "extensions.list", "").profile == &regular);
  assert(Resolve(work, "extensions.list", "work").profile == &isolated);
  assert(Resolve(work, "extensions.list", "incognito:w1@").code == "ERR_PROFILE_PRIVATE");
  assert(Resolve(work, "extensions.list", "gone").code == "ERR_PROFILE_UNAVAILABLE");

  std::string code;
  assert(ardia::ProfileTab(work, &isolated, "work-tab", &code) == &isolated_tab && code.empty());
  assert(!ardia::ProfileTab(work, &isolated, "regular-tab", &code) && code == "ERR_PROFILE_WINDOW");
  code.clear();
  assert(!ardia::ProfileTab(work, &isolated, "missing", &code) && code == "ERR_TAB_UNAVAILABLE");

  const std::string accepted = Prompt(&isolated, 7, isolated_weak);
  Reply reply = Answer(work, accepted, true);
  assert(reply.ok);
  base::RunPostedTasks();
  assert(answers.size() == 1 && answers[0] == extensions::ExtensionInstallPromptClient::Result::ACCEPTED);
  assert(Answer(work, accepted, true).code == "ERR_EXTENSION_PROMPT_STALE");

  const std::string cancelled = Prompt(&isolated, 7, isolated_weak);
  ardia::LinuxExtensionWindow other = work;
  other.window = 8;
  assert(Answer(other, cancelled, true).code == "ERR_EXTENSION_PROMPT_STALE");
  assert(Answer(work, cancelled, false).ok);
  base::RunPostedTasks();
  assert(answers.size() == 2 && answers[1] == extensions::ExtensionInstallPromptClient::Result::USER_CANCELED);

  const std::string foreign = Prompt(&regular, 7, regular_weak);
  assert(Answer(work, foreign, true).code == "ERR_EXTENSION_PROMPT_STALE");
  ardia::LinuxExtensionWindow plain = work;
  plain.profile = &regular;
  assert(Answer(plain, foreign, true).ok);
  base::RunPostedTasks();
  assert(answers.size() == 3);

  const std::string orphan = Prompt(&isolated, 7, isolated_weak);
  isolated_weak.InvalidateWeakPtrs();
  assert(Answer(work, orphan, true).ok);
  base::RunPostedTasks();
  assert(answers.size() == 3);

  std::vector<std::string> delivered;
  ardia::Delegate().deliver = base::RepeatingCallback<bool(int, std::string_view, base::DictValue)>(
      [&](int window, std::string_view name, base::DictValue data) {
        delivered.push_back(std::to_string(window) + " " + std::string(name) + " " + *data.FindString("requestId"));
        return true;
      });
  base::WeakPtrFactory<Profile> store_weak(&isolated);
  content::WebContents store_tab;
  store_tab.context = &isolated;
  const std::string closed_parent = PromptFor(&store_tab, &isolated, 7, store_weak);
  const size_t before = answers.size();
  store_tab.Destroy();
  assert(answers.size() == before && delivered.empty());
  base::RunPostedTasks();
  base::RunPostedTasks();
  assert(answers.size() == before + 1 && answers.back() == extensions::ExtensionInstallPromptClient::Result::ABORTED);
  assert(delivered == std::vector<std::string>{"7 extensions.installPromptCancelled " + closed_parent});
  assert(!ardia::Prompts().Find(closed_parent));
  assert(Answer(work, closed_parent, true).code == "ERR_EXTENSION_PROMPT_STALE");
  store_tab.Destroy();
  base::RunPostedTasks();
  assert(answers.size() == before + 1 && delivered.size() == 1);

  content::WebContents answered_tab;
  answered_tab.context = &isolated;
  const std::string answered = PromptFor(&answered_tab, &isolated, 7, store_weak);
  assert(Answer(work, answered, true).ok);
  base::RunPostedTasks();
  assert(answers.back() == extensions::ExtensionInstallPromptClient::Result::ACCEPTED);
  assert(answered_tab.observers.empty());
  answered_tab.Destroy();
  base::RunPostedTasks();
  assert(answers.size() == before + 2 && delivered.size() == 1);

  content::WebContents moved_tab;
  moved_tab.context = &isolated;
  const std::string moved = PromptFor(&moved_tab, &isolated, 7, store_weak);
  assert(ardia::Prompts().Move(moved, 9));
  moved_tab.Destroy();
  base::RunPostedTasks();
  base::RunPostedTasks();
  assert(delivered.back() == "9 extensions.installPromptCancelled " + moved);
  assert(answers.back() == extensions::ExtensionInstallPromptClient::Result::ABORTED);

  content::WebContents closing_tab;
  closing_tab.context = &isolated;
  content::WebContents* holder_tab = nullptr;
  ardia::Delegate().window_for = base::RepeatingCallback<int(Profile*, content::WebContents*, int)>(
      [&](Profile*, content::WebContents* contents, int excluded) { return contents && contents == holder_tab ? 9 : excluded == 8 ? 7 : 8; });
  ardia::Delegate().tab_key = base::RepeatingCallback<std::string(int, content::WebContents*)>(
      [&](int window, content::WebContents* contents) { return window == 9 && contents && contents == holder_tab ? std::string("moved-tab") : std::string(); });
  delivered.clear();
  const std::string bound = PromptFor(&closing_tab, &isolated, 7, store_weak);
  const std::string loose = Prompt(&isolated, 7, isolated_weak);
  const size_t answered_before_close = answers.size();
  ardia::LinuxExtensionsWindowClosing(7);
  assert(ardia::Prompts().Find(bound) && ardia::Prompts().Find(bound)->window == 7);
  assert(ardia::Prompts().Find(loose) && ardia::Prompts().Find(loose)->window == 8);
  assert(delivered == std::vector<std::string>{"8 extensions.installPrompt " + loose});
  closing_tab.Destroy();
  base::RunPostedTasks();
  base::RunPostedTasks();
  assert(!ardia::Prompts().Find(bound));
  assert(answers.size() == answered_before_close + 1 && answers.back() == extensions::ExtensionInstallPromptClient::Result::ABORTED);
  assert(delivered.back() == "7 extensions.installPromptCancelled " + bound);

  content::WebContents travelling_tab;
  travelling_tab.context = &isolated;
  holder_tab = &travelling_tab;
  delivered.clear();
  const std::string travelled = PromptFor(&travelling_tab, &isolated, 7, store_weak);
  ardia::LinuxExtensionsWindowClosing(7);
  assert(ardia::Prompts().Find(travelled)->window == 9);
  assert(delivered == std::vector<std::string>{"9 extensions.installPrompt " + travelled});
  assert(ardia::Prompts().Find(travelled)->payload.FindString("tabId") && *ardia::Prompts().Find(travelled)->payload.FindString("tabId") == "moved-tab");

  content::WebContents reload_tab;
  reload_tab.context = &isolated;
  delivered.clear();
  const std::string reloaded = PromptFor(&reload_tab, &isolated, 7, store_weak);
  ardia::LinuxExtensionsWindowRetired(7);
  assert(ardia::Prompts().Find(reloaded)->window == 8);
  assert(delivered.size() == 1 && delivered[0] == "8 extensions.installPrompt " + reloaded);
  holder_tab = nullptr;
  ardia::Prompts().TakeAll();
  base::RunPostedTasks();

  ardia::LinuxExtensionWindow private_window = work;
  private_window.profile = &incognito;
  for (const char* call : {"extensions.actionStates", "extensions.sidePanelUrl"}) {
    const Outcome outcome = Resolve(private_window, call, "");
    assert(outcome.profile == &incognito && outcome.code.empty());
  }
  assert(Resolve(private_window, "extensions.resolveInstallPrompt", "").code == "ERR_PROFILE_PRIVATE");
  assert(Resolve(private_window, "extensions.setEnabled", "incognito:w1@").code == "ERR_PROFILE_PRIVATE");
  for (const char* requested : {"", "work", "incognito:w1@"}) {
    for (const char* call : {"extensions.uninstall", "extensions.setEnabled", "extensions.configure",
                             "extensions.install", "extensions.syncApply", "search.engines"}) {
      const Outcome outcome = Resolve(private_window, call, requested);
      assert(!outcome.profile && outcome.code == "ERR_PROFILE_PRIVATE");
    }
    for (const char* call : {"extensions.watchActions", "extensions.list"}) {
      const Outcome outcome = Resolve(private_window, call, requested);
      assert(outcome.profile == &regular && outcome.code.empty());
    }
  }
  incognito.shutdown_started = true;
  assert(Resolve(private_window, "extensions.actionStates", "").code == "ERR_PROFILE_ENDING");
  incognito.shutdown_started = false;
  ardia::LinuxExtensionWindow closed = work;
  closed.profile = nullptr;
  assert(Resolve(closed, "extensions.sidePanelUrl", "").code == "ERR_WINDOW_CLOSED");
  std::printf("extension service scenarios passed\n");
}
