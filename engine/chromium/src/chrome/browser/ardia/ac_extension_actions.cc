// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
#include "chrome/browser/extensions/extension_action_dispatcher.h"
#include "chrome/browser/profiles/profile.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_registry_observer.h"
#include "extensions/common/extension.h"

namespace ardia {
namespace {

class ActionWatch : public ProfileState,
                    public extensions::ExtensionActionDispatcher::Observer,
                    public extensions::SidePanelService::Observer,
                    public extensions::ExtensionRegistryObserver {
 public:
  explicit ActionWatch(Profile* profile)
      : ProfileState(profile),
        dispatcher_(extensions::ExtensionActionDispatcher::Get(profile)),
        side_panels_(extensions::SidePanelService::Get(profile)) {
    if (dispatcher_) {
      dispatcher_->AddObserver(this);
    }
    if (side_panels_) {
      side_panels_->AddObserver(this);
    }
    if (auto* registry = extensions::ExtensionRegistry::Get(profile)) {
      registry_observation_.Observe(registry);
    }
  }

  ~ActionWatch() override { Release(); }

 private:
  void Release() override {
    if (dispatcher_) {
      dispatcher_->RemoveObserver(this);
      dispatcher_ = nullptr;
    }
    if (side_panels_) {
      side_panels_->RemoveObserver(this);
      side_panels_ = nullptr;
    }
    registry_observation_.Reset();
    weak_factory_.InvalidateWeakPtrs();
  }

  void OnExtensionActionUpdated(
      extensions::ExtensionAction* extension_action,
      content::WebContents* web_contents,
      content::BrowserContext* browser_context) override {
    if (!extension_action) {
      return;
    }
    Changed(extension_action->extension_id(), "action");
  }

  void OnShuttingDown() override {
    if (dispatcher_) {
      dispatcher_->RemoveObserver(this);
      dispatcher_ = nullptr;
    }
  }

  void OnPanelOptionsChanged(
      const extensions::ExtensionId& extension_id,
      const extensions::api::side_panel::PanelOptions& updated_options)
      override {
    Changed(extension_id, "sidePanel");
  }

  void OnSidePanelServiceShutdown() override {
    if (side_panels_) {
      side_panels_->RemoveObserver(this);
      side_panels_ = nullptr;
    }
  }

  void OnExtensionLoaded(content::BrowserContext* browser_context,
                         const extensions::Extension* extension) override {
    Changed(extension->id(), "registry");
  }

  void OnExtensionUnloaded(content::BrowserContext* browser_context,
                           const extensions::Extension* extension,
                           extensions::UnloadedExtensionReason reason) override {
    Changed(extension->id(), "registry");
  }

  void OnShutdown(extensions::ExtensionRegistry* registry) override {
    registry_observation_.Reset();
  }

  void Changed(const extensions::ExtensionId& extension_id, const char* kind) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&ActionWatch::Emit, weak_factory_.GetWeakPtr(),
                                  extension_id, std::string(kind)));
  }

  void Emit(const extensions::ExtensionId& extension_id,
            const std::string& kind) {
    ardia::Emit("extensions.action", profile(),
                base::DictValue().Set("id", extension_id).Set("kind", kind));
  }

  raw_ptr<extensions::ExtensionActionDispatcher> dispatcher_;
  raw_ptr<extensions::SidePanelService> side_panels_;
  base::ScopedObservation<extensions::ExtensionRegistry,
                          extensions::ExtensionRegistryObserver>
      registry_observation_{this};
  base::WeakPtrFactory<ActionWatch> weak_factory_{this};
};

}
}

AC_PROFILE_CALL(ac_extensions_watch_actions) {
  ardia::StateFor<ardia::ActionWatch>(call.profile());
  call.TakeReply().Ok();
}
