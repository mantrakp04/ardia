// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_video_upscaler.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <optional>
#include <utility>

#include "ardia/core/ac_video_upscaler_internal.h"
#include "base/functional/bind.h"
#include "base/trace_event/trace_event.h"

namespace ardiacore {

namespace {

constexpr float kStartRatio = 1.15f;
constexpr float kStopRatio = 1.0f;
constexpr int kMaxTargetDimension = 6144;
constexpr int kMinSourceDimension = 64;
constexpr base::TimeDelta kIdleTeardown = base::Seconds(3);

int AlignUp16(int value) {
  return (value + 15) & ~15;
}

bool IsVideoPixelFormat(OSType format) {
  return format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange ||
         format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;
}

}

Upscaler::Upscaler(base::RepeatingClosure on_upscaled)
    : on_upscaled_(std::move(on_upscaled)),
      task_runner_(base::SequencedTaskRunner::GetCurrentDefault()) {}

Upscaler::~Upscaler() {
  ++generation_;
}

void Upscaler::Process(bool allowed, std::vector<VideoUpscaleCandidate>& candidates) {
  if (!allowed) {
    if (gate_open_) {
      TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.GateClosed", TRACE_EVENT_SCOPE_THREAD);
    }
    gate_open_ = false;
    kit_requested_.reset();
    CancelSetup();
    Forget();
    return;
  }
  if (!gate_open_) {
    gate_open_ = true;
    disabled_.reset();
    TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.GateOpen", TRACE_EVENT_SCOPE_THREAD);
  }
  if (@available(macOS 26.0, *)) {
    VideoUpscaleCandidate* best = nullptr;
    std::optional<VideoKey> best_key;
    for (auto& candidate : candidates) {
      std::optional<VideoKey> key = Eligible(candidate);
      if (!key) {
        continue;
      }
      if (!best || key->target.GetArea() > best_key->target.GetArea()) {
        best = &candidate;
        best_key = key;
      }
    }
    if (!best || !Upscaling(*best_key)) {
      Forget();
      return;
    }
    ArmIdleTeardown();
    current_source_.reset(best->source, base::scoped_policy::RETAIN);
    current_key_ = best_key;
    if (cache_output_ && cache_source_.get() == best->source &&
        cache_seed_ == IOSurfaceGetSeed(best->source) && cache_key_ == best_key) {
      best->output = cache_output_;
      TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.CacheHit", TRACE_EVENT_SCOPE_THREAD);
      return;
    }
    if (job_in_flight_) {
      best->pending = job_in_flight_source_ == best->source;
      return;
    }
    std::optional<Plan> plan = MakePlan(*best, *best_key);
    if (!plan) {
      return;
    }
    if (!kit_ || !kit_plan_ || !(*kit_plan_ == *plan)) {
      RequestKit(*plan);
      return;
    }
    Start(*best, *plan);
    best->pending = job_in_flight_ != 0;
  } else {
    Forget();
  }
}

std::optional<VideoKey> Upscaler::Eligible(const VideoUpscaleCandidate& candidate) {
  if (!candidate.source || candidate.protected_video_type != gfx::ProtectedVideoType::kClear ||
      candidate.has_hdr_metadata || candidate.color_space.IsHDR()) {
    return std::nullopt;
  }
  const OSType format = IOSurfaceGetPixelFormat(candidate.source);
  if (!IsVideoPixelFormat(format)) {
    return std::nullopt;
  }
  const int width = (int)IOSurfaceGetWidth(candidate.source);
  const int height = (int)IOSurfaceGetHeight(candidate.source);
  gfx::RectF crop = candidate.contents_rect;
  crop.Scale(width, height);
  if (!gfx::RectF(width, height).Contains(crop) || crop.width() < kMinSourceDimension ||
      crop.height() < kMinSourceDimension) {
    return std::nullopt;
  }
  gfx::Size target(static_cast<int>(std::lround(candidate.target_size.width())),
                   static_cast<int>(std::lround(candidate.target_size.height())));
  if (target.width() > kMaxTargetDimension || target.height() > kMaxTargetDimension ||
      target.IsEmpty()) {
    return std::nullopt;
  }
  if (!LumaWeights(candidate.source, candidate.color_space)) {
    return std::nullopt;
  }
  return VideoKey{crop, target, format, candidate.color_space};
}

bool Upscaler::Upscaling(const VideoKey& key) {
  if (disabled_ && disabled_->crop.size() == key.crop.size()) {
    return false;
  }
  const float ratio = std::min(key.target.width() / key.crop.width(),
                               key.target.height() / key.crop.height());
  if (!active_ || active_->crop.size() != key.crop.size()) {
    active_.reset();
    if (ratio >= kStartRatio) {
      active_ = key;
    }
  } else if (ratio <= kStopRatio) {
    active_.reset();
  } else {
    active_ = key;
  }
  return active_.has_value();
}

API_AVAILABLE(macos(26.0))
std::optional<Plan> Upscaler::MakePlan(const VideoUpscaleCandidate& candidate, const VideoKey& key) {
  Plan plan;
  plan.key = key;
  plan.surface_size = gfx::Size(IOSurfaceGetWidth(candidate.source),
                                IOSurfaceGetHeight(candidate.source));
  const int left = static_cast<int>(std::floor(key.crop.x())) & ~1;
  const int top = static_cast<int>(std::floor(key.crop.y())) & ~1;
  const int right = std::min(plan.surface_size.width(),
                             (static_cast<int>(std::ceil(key.crop.right())) + 1) & ~1);
  const int bottom = std::min(plan.surface_size.height(),
                              (static_cast<int>(std::ceil(key.crop.bottom())) + 1) & ~1);
  plan.region = gfx::Rect(left, top, right - left, bottom - top);
  if (!gfx::RectF(plan.region).Contains(key.crop)) {
    return std::nullopt;
  }
  const float ratio = std::min(key.target.width() / key.crop.width(),
                               key.target.height() / key.crop.height());
  if (VTLowLatencySuperResolutionScalerConfiguration.isSupported &&
      key.format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange) {
    const gfx::Size aligned(AlignUp16(plan.region.width()), AlignUp16(plan.region.height()));
    const CMVideoDimensions max =
        VTLowLatencySuperResolutionScalerConfiguration.maximumDimensions;
    const CMVideoDimensions min =
        VTLowLatencySuperResolutionScalerConfiguration.minimumDimensions;
    if (aligned.width() <= max.width && aligned.height() <= max.height &&
        aligned.width() >= min.width && aligned.height() >= min.height) {
      NSArray<NSNumber*>* factors = [VTLowLatencySuperResolutionScalerConfiguration
          supportedScaleFactorsForFrameWidth:aligned.width()
                                 frameHeight:aligned.height()];
      for (NSNumber* factor in factors) {
        if (factor.floatValue <= ratio + 0.001f && factor.floatValue > plan.vt_factor) {
          plan.vt_factor = factor.floatValue;
        }
      }
      if (plan.vt_factor > 0 && vt_failed_ != aligned) {
        plan.vt_input = aligned;
        plan.vt_needs_pad = plan.region != gfx::Rect(plan.surface_size) ||
                            aligned != plan.surface_size;
      } else {
        plan.vt_factor = 0;
      }
    }
  }
  if (plan.vt_factor > 0) {
    plan.rgb_size = key.target;
  } else {
    plan.rgb_size = gfx::Size(static_cast<int>(std::ceil(key.crop.width())),
                              static_cast<int>(std::ceil(key.crop.height())));
  }
  plan.needs_metalfx = plan.vt_factor == 0 && plan.rgb_size != key.target;
  return plan;
}

void Upscaler::Forget() {
  current_source_.reset();
  current_key_.reset();
  if (!idle_timer_.IsRunning() && HoldsAnything()) {
    ArmIdleTeardown();
  }
}

bool Upscaler::HoldsAnything() const {
  return kit_ || kit_requested_ || setup_worker_ || job_in_flight_ || cache_output_ ||
         !outputs_.empty();
}

void Upscaler::CancelSetup() {
  if (setup_worker_) {
    setup_worker_->cancelled = true;
  }
  setup_in_flight_ = 0;
}

void Upscaler::ArmIdleTeardown() {
  idle_timer_.Start(FROM_HERE, kIdleTeardown,
                    base::BindOnce(&Upscaler::TearDown, base::Unretained(this)));
}

void Upscaler::TearDown() {
  TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.IdleWake", TRACE_EVENT_SCOPE_THREAD);
  if (!HoldsAnything()) {
    return;
  }
  TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.TearDown", TRACE_EVENT_SCOPE_THREAD);
  ++generation_;
  ArdiaVideoUpscalerKit* kit = kit_;
  kit_ = nil;
  if (kit) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      (void)kit;
    });
  }
  kit_plan_.reset();
  kit_requested_.reset();
  kit_failed_.reset();
  CancelSetup();
  job_in_flight_ = 0;
  job_in_flight_source_ = nullptr;
  cache_source_.reset();
  cache_output_.reset();
  cache_key_.reset();
  outputs_.clear();
  output_size_ = gfx::Size();
  active_.reset();
  vt_failed_ = gfx::Size();
  jobs_ = 0;
  misses_ = 0;
}

std::unique_ptr<VideoUpscaler> CreateVideoUpscaler(base::RepeatingClosure on_upscaled) {
  if (@available(macOS 26.0, *)) {
    return std::make_unique<Upscaler>(std::move(on_upscaled));
  }
  return nullptr;
}

}
