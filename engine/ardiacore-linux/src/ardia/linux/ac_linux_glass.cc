#include "ardia/linux/ac_linux_glass.h"

#include <cmath>
#include <optional>
#include <set>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_glass_geometry.h"
#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "components/viz/common/frame_timing_details.h"
#include "gpu/config/gpu_info.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#include "ui/compositor/layer_solid_color.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/gfx/geometry/transform.h"
#include "ui/views/views_features.h"

namespace content {
bool ArdiaLinuxGpuCompositingDisabled();
}

namespace ardia {
namespace {

namespace glass = linux_glass;

std::optional<double> Number(const base::DictValue* dict, std::string_view key) {
  return dict ? dict->FindDouble(key) : std::nullopt;
}

}

ShellGlassView::ShellGlassView(Emit emit) : emit_(std::move(emit)) {
  SetPaintToLayer(ui::LAYER_NOT_DRAWN);
  layer()->SetFillsBoundsOpaquely(false);
  layer()->SetName("ArdiaGlass");
  SetCanProcessEventsWithinSubtree(false);
  if (content::GpuDataManager::Initialized()) gpu_observation_.Observe(content::GpuDataManager::GetInstance());
  available_ = Supported();
}

ShellGlassView::~ShellGlassView() = default;

bool ShellGlassView::Supported() {
  if (!base::FeatureList::IsEnabled(views::features::kNativeViewHostManagesLayers)) return false;
  if (!content::GpuDataManager::Initialized()) return false;
  content::GpuDataManager* gpu = content::GpuDataManager::GetInstance();
  if (!gpu->HardwareAccelerationEnabled() || !gpu->IsEssentialGpuInfoAvailable()) return false;
  if (content::ArdiaLinuxGpuCompositingDisabled()) return false;
  const gpu::GPUInfo info = gpu->GetGPUInfo();
  return info.gl_renderer.find("SwiftShader") == std::string::npos &&
         info.gl_renderer.find("llvmpipe") == std::string::npos;
}

void ShellGlassView::Apply(const base::DictValue& args, double zoom, Done done) {
  const std::optional<int> generation = args.FindInt("generation");
  const base::ListValue* list = args.FindList("regions");
  if (!generation || *generation < 0 || !list) {
    return std::move(done).Run(false, base::Value("Glass regions need a generation and a list of regions"));
  }
  struct Wanted {
    std::string id;
    glass::LayerPlacement placement;
    float opacity;
  };
  std::vector<Wanted> wanted;
  for (const auto& entry : *list) {
    const base::DictValue* item = entry.GetIfDict();
    const std::string* id = item ? item->FindString("id") : nullptr;
    const base::DictValue* rect = item ? item->FindDict("rect") : nullptr;
    const base::DictValue* radii = item ? item->FindDict("radii") : nullptr;
    const double opacity = item ? item->FindDouble("opacity").value_or(NAN) : NAN;
    const std::optional<glass::LayerPlacement> placement =
        id && !id->empty() && id->size() <= 64 && rect && radii
            ? glass::PlaceRegion(
                  {Number(rect, "x").value_or(NAN), Number(rect, "y").value_or(NAN), Number(rect, "width").value_or(NAN),
                   Number(rect, "height").value_or(NAN)},
                  {Number(radii, "upperLeft").value_or(NAN), Number(radii, "upperRight").value_or(NAN),
                   Number(radii, "lowerRight").value_or(NAN), Number(radii, "lowerLeft").value_or(NAN)},
                  item->FindDouble("blur").value_or(NAN), zoom)
            : std::nullopt;
    if (!placement || !std::isfinite(opacity) || opacity < 0 || opacity > 1) {
      return std::move(done).Run(false, base::Value("Each glass region needs an id, a finite rect, radii, blur and opacity"));
    }
    wanted.push_back({*id, *placement, static_cast<float>(opacity)});
  }
  base::ListValue accepted;
  std::set<std::string> kept;
  if (available_ && SoftwareCompositor()) Refresh();
  if (available_) {
    for (const Wanted& region : wanted) {
      if (kept.size() >= glass::kMaxRegions) break;
      if (kept.contains(region.id)) continue;
      const glass::LayerPlacement& p = region.placement;
      const gfx::Rect bounds(p.x, p.y, p.width, p.height);
      std::unique_ptr<ui::Layer>& slot = regions_[region.id];
      if (!slot) {
        slot = ui::Layer::Create(ui::LAYER_SOLID_COLOR);
        slot->SetName("ArdiaGlassRegion");
        slot->AsSolidColor()->SetColor(SkColors::kTransparent);
        slot->SetIsFastRoundedCorner(true);
        layer()->Add(slot.get());
      }
      ui::Layer* target = slot.get();
      target->SetBounds(bounds);
      gfx::Transform transform;
      transform.Translate(p.offset_x, p.offset_y);
      transform.Scale(p.scale_x, p.scale_y);
      target->SetTransform(transform);
      target->SetRoundedCornerRadius(gfx::RoundedCornersF(static_cast<float>(p.radii.upper_left),
                                                          static_cast<float>(p.radii.upper_right),
                                                          static_cast<float>(p.radii.lower_right),
                                                          static_cast<float>(p.radii.lower_left)));
      target->SetBackgroundBlur(static_cast<float>(p.blur));
      target->SetOpacity(region.opacity);
      target->SetVisible(true);
      kept.insert(region.id);
      accepted.Append(region.id);
    }
  }
  std::erase_if(regions_, [&](const auto& entry) { return !kept.contains(entry.first); });
  RequestPresented(*generation);
  std::move(done).Run(true, base::Value(base::DictValue()
                                            .Set("generation", *generation)
                                            .Set("available", available_)
                                            .Set("accepted", std::move(accepted))));
}

void ShellGlassView::Clear() {
  presentation_weak_factory_.InvalidateWeakPtrs();
  regions_.clear();
}

bool ShellGlassView::SoftwareCompositor() {
  ui::Compositor* compositor = layer()->GetCompositor();
  return compositor && compositor->force_software_compositor();
}

void ShellGlassView::OnGpuInfoUpdate() { Refresh(); }

void ShellGlassView::OnGpuProcessCrashed() { Refresh(); }

void ShellGlassView::Refresh() {
  const bool now = Supported() && !SoftwareCompositor();
  if (now == available_) return;
  available_ = now;
  if (!available_) Clear();
  emit_.Run("available", base::Value(base::DictValue().Set("value", available_)));
}

void ShellGlassView::RequestPresented(int generation) {
  ui::Compositor* compositor = layer()->GetCompositor();
  if (!compositor) return;
  compositor->RequestSuccessfulPresentationTimeForNextFrame(base::BindOnce(
      [](base::WeakPtr<ShellGlassView> view, int generation, const viz::FrameTimingDetails&) {
        if (view) view->Presented(generation);
      },
      presentation_weak_factory_.GetWeakPtr(), generation));
  compositor->ScheduleDraw();
}

void ShellGlassView::Presented(int generation) {
  emit_.Run("presented", base::Value(base::DictValue().Set("generation", generation)));
}

BEGIN_METADATA(ShellGlassView)
END_METADATA

}
