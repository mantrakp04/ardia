// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <cmath>
#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/system/sys_info.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ardia/ac_input_frame_rate.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/performance_manager/public/user_tuning/battery_saver_mode_manager.h"
#include "chrome/browser/task_manager/providers/task.h"
#include "chrome/browser/task_manager/task_manager_interface.h"
#include "chrome/browser/task_manager/task_manager_metrics_recorder.h"
#include "chrome/browser/task_manager/task_manager_observer.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/dialogs/browser_dialogs.h"
#include "components/component_updater/component_updater_service.h"
#include "components/performance_manager/public/user_tuning/prefs.h"
#include "components/prefs/pref_service.h"
#include "components/sessions/core/session_id.h"
#include "components/update_client/crx_update_item.h"
#include "components/update_client/update_client.h"
#include "content/public/browser/browser_thread.h"

namespace ardia {
namespace {

const char* TypeName(task_manager::Task::Type type) {
  using task_manager::Task;
  switch (type) {
    case Task::BROWSER:
      return "browser";
    case Task::GPU:
      return "gpu";
    case Task::ZYGOTE:
      return "zygote";
    case Task::UTILITY:
      return "utility";
    case Task::RENDERER:
      return "renderer";
    case Task::EXTENSION:
      return "extension";
    case Task::GUEST:
      return "guest";
    case Task::SANDBOX_HELPER:
      return "sandboxHelper";
    case Task::DEDICATED_WORKER:
      return "dedicatedWorker";
    case Task::SHARED_WORKER:
      return "sharedWorker";
    case Task::SERVICE_WORKER:
      return "serviceWorker";
    default:
      return "unknown";
  }
}

const char* StateName(update_client::ComponentState state) {
  using update_client::ComponentState;
  switch (state) {
    case ComponentState::kNew:
      return "new";
    case ComponentState::kChecking:
      return "checking";
    case ComponentState::kCanUpdate:
      return "canUpdate";
    case ComponentState::kDownloading:
      return "downloading";
    case ComponentState::kDecompressing:
      return "decompressing";
    case ComponentState::kPatching:
      return "patching";
    case ComponentState::kUpdating:
      return "updating";
    case ComponentState::kUpdated:
      return "updated";
    case ComponentState::kUpToDate:
      return "upToDate";
    case ComponentState::kUpdateError:
      return "updateError";
    case ComponentState::kRun:
      return "run";
  }
  return "unknown";
}

class Sampler : public task_manager::TaskManagerObserver {
 public:
  Sampler()
      : TaskManagerObserver(base::Seconds(2),
                            task_manager::REFRESH_TYPE_CPU |
                                task_manager::REFRESH_TYPE_GPU_MEMORY |
                                task_manager::REFRESH_TYPE_MEMORY_FOOTPRINT) {}

  task_manager::TaskManagerInterface* Use() {
    task_manager::TaskManagerInterface* manager =
        task_manager::TaskManagerInterface::GetTaskManager();
    if (!observed_task_manager()) {
      manager->AddObserver(this);
    }
    idle_.Start(FROM_HERE, base::Seconds(15),
                base::BindOnce(&Sampler::Stop, base::Unretained(this)));
    return manager;
  }

 private:
  void Stop() {
    if (observed_task_manager()) {
      observed_task_manager()->RemoveObserver(this);
    }
  }

  base::OneShotTimer idle_;
};

Sampler& TheSampler() {
  static base::NoDestructor<Sampler> sampler;
  return *sampler;
}

}
}

AC_ARGS_CALL(ac_tasks_list) {
  ardia::Reply out = call.TakeReply();
  task_manager::TaskManagerInterface* manager = ardia::TheSampler().Use();
  const int processors = base::SysInfo::NumberOfProcessors();
  base::ListValue tasks;
  for (task_manager::TaskId id : manager->GetTaskIdsList()) {
    double cpu = manager->GetPlatformIndependentCPUUsage(id);
    if (!std::isfinite(cpu)) {
      cpu = 0;
    }
    const auto memory = manager->GetMemoryFootprintUsage(id);
    bool duplicates = false;
    const auto gpu_memory = manager->GetGpuMemoryUsage(id, &duplicates);
    base::ListValue tab_ids;
    if (const SessionID tab = manager->GetTabId(id); tab.is_valid()) {
      tab_ids.Append(tab.id());
    }
    tasks.Append(
        base::DictValue()
            .Set("id", static_cast<double>(id))
            .Set("type", ardia::TypeName(manager->GetType(id)))
            .Set("title", base::UTF16ToUTF8(manager->GetTitle(id)))
            .Set("killable", manager->IsTaskKillable(id))
            .Set("cpu", cpu)
            .Set("processors", processors)
            .Set("memory",
                 memory ? static_cast<double>(memory->InBytes()) : 0.0)
            .Set("gpuMemory",
                 gpu_memory ? static_cast<double>(gpu_memory->InBytes()) : 0.0)
            .Set("tabIds", std::move(tab_ids))
            .Set("browserIds", base::ListValue()));
  }
  out.Send(base::DictValue().Set("tasks", std::move(tasks)));
}

AC_ARGS_CALL(ac_task_manager_open) {
  ardia::Reply out = call.TakeReply();
  if (call.Bool("hide")) {
    chrome::HideTaskManager();
  } else {
    chrome::OpenTaskManager(
        GetLastActiveBrowserWindowInterfaceWithAnyProfile(),
        task_manager::StartAction::kMainMenu);
  }
  out.Send(base::DictValue().Set("ok", true));
}

AC_ARGS_CALL(ac_battery_saver) {
  ardia::HoldFullFrameRateDuringInput();
  ardia::Reply out = call.TakeReply();
  PrefService* local_state =
      g_browser_process ? g_browser_process->local_state() : nullptr;
  if (!local_state) {
    return out.Error("no local state");
  }
  using performance_manager::user_tuning::prefs::BatterySaverModeState;
  const char* pref =
      performance_manager::user_tuning::prefs::kBatterySaverModeState;
  if (const std::string* mode = call.args().FindString("mode")) {
    if (*mode == "on") {
      local_state->SetInteger(pref,
                              static_cast<int>(BatterySaverModeState::kEnabled));
    } else if (*mode == "off") {
      local_state->SetInteger(
          pref, static_cast<int>(BatterySaverModeState::kDisabled));
    } else if (*mode == "default") {
      local_state->ClearPref(pref);
    } else {
      return out.Error("mode is on, off or default");
    }
  }
  auto* manager =
      performance_manager::user_tuning::BatterySaverModeManager::HasInstance()
          ? performance_manager::user_tuning::BatterySaverModeManager::
                GetInstance()
          : nullptr;
  out.Send(base::DictValue()
               .Set("state", local_state->GetInteger(pref))
               .Set("active", manager && manager->IsBatterySaverActive()));
}

AC_ARGS_CALL(ac_components_list) {
  ardia::Reply out = call.TakeReply();
  base::ListValue components;
  component_updater::ComponentUpdateService* updater =
      g_browser_process ? g_browser_process->component_updater() : nullptr;
  if (updater) {
    for (const component_updater::ComponentInfo& info :
         updater->GetComponents()) {
      update_client::CrxUpdateItem item;
      const char* state = updater->GetComponentDetails(info.id, &item)
                              ? ardia::StateName(item.state)
                              : "unknown";
      components.Append(
          base::DictValue()
              .Set("id", info.id)
              .Set("name", base::UTF16ToUTF8(info.name))
              .Set("version",
                   info.version.IsValid() ? info.version.GetString() : "")
              .Set("state", state));
    }
  }
  out.Send(base::DictValue().Set("components", std::move(components)));
}
