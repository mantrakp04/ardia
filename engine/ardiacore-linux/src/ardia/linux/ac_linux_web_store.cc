#include "ardia/linux/ac_linux_web_store.h"

#include <algorithm>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_web_store_queue.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "extensions/browser/api/management/management_api.h"
#include "extensions/browser/api/management/management_api_delegate.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/common/extension.h"
#include "extensions/common/extension_urls.h"

extern std::unique_ptr<extensions::UninstallDialogDelegate> (*g_ardia_linux_store_uninstall)(
    extensions::ManagementUninstallFunctionBase* function, const extensions::Extension* target_extension);

namespace ardiacore {
namespace {

using Done = base::OnceCallback<void(bool, base::Value)>;

constexpr char kRelabelScript[] = R"((() => {
  if (window.__ardiaStoreRelabel) return;
  window.__ardiaStoreRelabel = true;
  const relabel = () => {
    for (const el of document.querySelectorAll("button, button *")) {
      if (el.childElementCount) continue;
      const t = el.textContent;
      if (t === "Add to Chrome") el.textContent = "Add to Ardia";
      else if (t === "Remove from Chrome") el.textContent = "Remove from Ardia";
    }
  };
  relabel();
  new MutationObserver(relabel).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})())";

base::RepeatingCallback<bool(content::WebContents*)>& HoldsTab() {
  static base::NoDestructor<base::RepeatingCallback<bool(content::WebContents*)>> holds;
  return *holds;
}

base::RepeatingCallback<bool(content::WebContents*)>& Confirming() {
  static base::NoDestructor<base::RepeatingCallback<bool(content::WebContents*)>> confirming;
  return *confirming;
}

base::Value Superseded() {
  return base::Value(base::DictValue().Set("superseded", true));
}

double Now() {
  return base::TimeTicks::Now().since_origin().InSecondsF();
}

class StoreUninstall : public extensions::UninstallDialogDelegate {
 public:
  explicit StoreUninstall(extensions::ManagementUninstallFunctionBase* function) : function_(function) {}
  StoreUninstall(const StoreUninstall&) = delete;
  StoreUninstall& operator=(const StoreUninstall&) = delete;
  ~StoreUninstall() override = default;

  void Close(bool removed) {
    extensions::ManagementUninstallFunctionBase* function = std::exchange(function_, nullptr);
    if (function) function->OnExtensionUninstallDialogClosed(removed, removed ? std::u16string() : u"Ardia kept the extension");
  }

  base::WeakPtr<StoreUninstall> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

 private:
  raw_ptr<extensions::ManagementUninstallFunctionBase> function_;
  base::WeakPtrFactory<StoreUninstall> weak_factory_{this};
};

class LinuxWebStore : public content::WebContentsObserver,
                      public content::WebContentsUserData<LinuxWebStore>,
                      public extensions::ExtensionRegistryObserver {
 public:
  LinuxWebStore(const LinuxWebStore&) = delete;
  LinuxWebStore& operator=(const LinuxWebStore&) = delete;
  ~LinuxWebStore() override = default;

  void Add(const std::string& extension_id, base::WeakPtr<StoreUninstall> request) {
    const auto id = queue_.Add(extension_id);
    if (!id) {
      base::SequencedTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, base::BindOnce([](base::WeakPtr<StoreUninstall> request) {
        if (request) request->Close(false);
      }, std::move(request)));
      return;
    }
    requests_[*id] = std::move(request);
    if (!registry_.IsObserving()) registry_.Observe(extensions::ExtensionRegistry::Get(web_contents()->GetBrowserContext()));
    Deliver();
  }

  void Wait(Done done) {
    if (waiter_) std::move(waiter_).Run(true, Superseded());
    waiter_ = std::move(done);
    Deliver();
  }

 private:
  friend class content::WebContentsUserData<LinuxWebStore>;
  explicit LinuxWebStore(content::WebContents* contents)
      : content::WebContentsObserver(contents), content::WebContentsUserData<LinuxWebStore>(*contents) {}

  void PrimaryPageChanged(content::Page&) override {
    Finish(queue_.Clear(), false);
    Release();
  }

  void WebContentsDestroyed() override {
    Finish(queue_.Clear(), false);
    Release();
  }

  void OnExtensionUninstalled(content::BrowserContext*, const extensions::Extension* extension,
                              extensions::UninstallReason) override {
    if (extension) Finish(queue_.Uninstalled(extension->id()), true);
  }

  void OnShutdown(extensions::ExtensionRegistry*) override { registry_.Reset(); }

  void Deliver() {
    if (waiter_) {
      if (auto id = queue_.Claim(Now())) std::move(waiter_).Run(true, base::Value(*id));
    }
    Schedule();
  }

  void Schedule() {
    if (!queue_.HasClaimed()) return ticker_.Stop();
    if (!ticker_.IsRunning()) {
      ticker_.Start(FROM_HERE, base::Seconds(1), base::BindRepeating(&LinuxWebStore::Tick, base::Unretained(this)));
    }
  }

  void Tick() {
    if (Confirming() && Confirming().Run(web_contents())) queue_.Renew(Now());
    Finish(queue_.Expired(Now()), false);
  }

  void Release() {
    if (waiter_) std::move(waiter_).Run(true, base::Value());
  }

  void Finish(std::vector<uint64_t> ids, bool removed) {
    std::vector<base::WeakPtr<StoreUninstall>> closing;
    for (const uint64_t id : ids) {
      auto found = requests_.find(id);
      if (found == requests_.end()) continue;
      closing.push_back(found->second);
      requests_.erase(found);
    }
    if (requests_.empty()) registry_.Reset();
    Schedule();
    for (auto& request : closing) {
      if (request) request->Close(removed);
    }
  }

  LinuxWebStoreQueue queue_;
  std::map<uint64_t, base::WeakPtr<StoreUninstall>> requests_;
  Done waiter_;
  base::RepeatingTimer ticker_;
  base::ScopedObservation<extensions::ExtensionRegistry, extensions::ExtensionRegistryObserver> registry_{this};
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(LinuxWebStore);

std::unique_ptr<extensions::UninstallDialogDelegate> TakeStoreUninstall(
    extensions::ManagementUninstallFunctionBase* function, const extensions::Extension* target_extension) {
  if (!function || !target_extension || function->extension() ||
      !extension_urls::IsWebstoreDomain(function->source_url())) {
    return nullptr;
  }
  content::WebContents* contents = function->GetSenderWebContents();
  if (!contents || !HoldsTab() || !HoldsTab().Run(contents)) return nullptr;
  auto request = std::make_unique<StoreUninstall>(function);
  LinuxWebStore::CreateForWebContents(contents);
  LinuxWebStore::FromWebContents(contents)->Add(target_extension->id(), request->GetWeakPtr());
  return request;
}

}

void InstallLinuxWebStore(base::RepeatingCallback<bool(content::WebContents*)> holds_tab,
                          base::RepeatingCallback<bool(content::WebContents*)> confirming) {
  HoldsTab() = std::move(holds_tab);
  Confirming() = std::move(confirming);
  g_ardia_linux_store_uninstall = &TakeStoreUninstall;
}

void LinuxWebStoreRequest(content::WebContents* contents, Done done) {
  if (!contents) return std::move(done).Run(true, base::Value());
  content::RenderFrameHost* frame = contents->GetPrimaryMainFrame();
  if (frame && frame->IsRenderFrameLive() && extension_urls::IsWebstoreDomain(frame->GetLastCommittedURL())) {
    frame->ExecuteJavaScriptInIsolatedWorld(base::UTF8ToUTF16(std::string_view(kRelabelScript)), base::NullCallback(),
                                            ISOLATED_WORLD_ID_ARDIA_PAGE);
  }
  LinuxWebStore::CreateForWebContents(contents);
  LinuxWebStore::FromWebContents(contents)->Wait(std::move(done));
}

}
