#ifndef ARDIA_LINUX_AC_LINUX_GLASS_H_
#define ARDIA_LINUX_AC_LINUX_GLASS_H_

#include <map>
#include <memory>
#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "content/public/browser/gpu_data_manager.h"
#include "content/public/browser/gpu_data_manager_observer.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

namespace ui {
class Layer;
}

namespace ardia {

class ShellGlassView : public views::View, public content::GpuDataManagerObserver {
  METADATA_HEADER(ShellGlassView, views::View)

 public:
  using Emit = base::RepeatingCallback<void(std::string_view event, base::Value payload)>;
  using Done = base::OnceCallback<void(bool, base::Value)>;

  explicit ShellGlassView(Emit emit);
  ShellGlassView(const ShellGlassView&) = delete;
  ShellGlassView& operator=(const ShellGlassView&) = delete;
  ~ShellGlassView() override;

  static bool Supported();
  bool available() const { return available_; }
  void Apply(const base::DictValue& args, double zoom, Done done);
  void Clear();

  void OnGpuInfoUpdate() override;
  void OnGpuProcessCrashed() override;

 private:
  bool SoftwareCompositor();
  void Refresh();
  void RequestPresented(int generation);
  void Presented(int generation);

  Emit emit_;
  bool available_ = false;
  std::map<std::string, std::unique_ptr<ui::Layer>> regions_;
  base::ScopedObservation<content::GpuDataManager, content::GpuDataManagerObserver> gpu_observation_{this};
  base::WeakPtrFactory<ShellGlassView> presentation_weak_factory_{this};
};

}

#endif
