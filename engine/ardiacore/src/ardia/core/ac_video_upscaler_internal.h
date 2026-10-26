// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_VIDEO_UPSCALER_INTERNAL_H_
#define ARDIA_CORE_AC_VIDEO_UPSCALER_INTERNAL_H_

#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <MetalFX/MetalFX.h>
#import <VideoToolbox/VideoToolbox.h>
#include <simd/simd.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/core/ac_video_upscaler.h"
#include "base/apple/scoped_cftyperef.h"
#include "base/functional/callback.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "ui/gfx/color_space.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/mac/io_surface.h"

@class ArdiaVideoUpscalerKit;

namespace ardiacore {

struct VideoKey {
  gfx::RectF crop;
  gfx::Size target;
  OSType format = 0;
  gfx::ColorSpace color_space;
  bool operator==(const VideoKey& other) const = default;
};

struct SetupCancel {
  std::atomic<bool> cancelled{false};
};

struct KitBox {
  ArdiaVideoUpscalerKit* __strong kit = nil;
};

struct Plan {
  VideoKey key;
  gfx::Size surface_size;
  gfx::Rect region;
  float vt_factor = 0;
  gfx::Size vt_input;
  bool vt_needs_pad = false;
  gfx::Size rgb_size;
  bool needs_metalfx = true;
  bool operator==(const Plan& other) const = default;
};

}

@interface ArdiaVideoUpscalerKit : NSObject
@property(nonatomic) id<MTLDevice> device;
@property(nonatomic) id<MTLCommandQueue> queue;
@property(nonatomic) id<MTLComputePipelineState> pad;
@property(nonatomic) id<MTLComputePipelineState> convert;
@property(nonatomic) VTFrameProcessor* processor API_AVAILABLE(macos(26.0));
@property(nonatomic)
    VTLowLatencySuperResolutionScalerConfiguration* configuration API_AVAILABLE(macos(26.0));
@property(nonatomic) CVPixelBufferRef paddedInput;
@property(nonatomic) CVPixelBufferRef vtOutput;
@property(nonatomic) id<MTLFXSpatialScaler> scaler API_AVAILABLE(macos(26.0));
@property(nonatomic) id<MTLTexture> rgb;
@end

namespace ardiacore {

std::optional<std::pair<float, float>> LumaWeights(IOSurfaceRef surface,
                                                   const gfx::ColorSpace& space);
simd_float4x4 YuvToRgbMatrix(float kr, float kb, bool full_range);
void CopyColorTags(IOSurfaceRef from, IOSurfaceRef to, const gfx::ColorSpace& space);
std::string SurfaceTags(IOSurfaceRef surface);

API_AVAILABLE(macos(26.0))
ArdiaVideoUpscalerKit* BuildKit(ArdiaVideoUpscalerKit* previous,
                                const Plan& plan,
                                const SetupCancel& cancel);

class Upscaler : public VideoUpscaler {
 public:
  explicit Upscaler(base::RepeatingClosure on_upscaled);
  ~Upscaler() override;

  void Process(bool allowed, std::vector<VideoUpscaleCandidate>& candidates) override;

 private:
  struct Job {
    gfx::ScopedInUseIOSurface source;
    uint32_t seed = 0;
    VideoKey key;
    gfx::ScopedInUseIOSurface output;
    base::TimeTicks started;
    base::TimeDelta encode;
  };

  std::optional<VideoKey> Eligible(const VideoUpscaleCandidate& candidate);
  bool Upscaling(const VideoKey& key);
  API_AVAILABLE(macos(26.0))
  std::optional<Plan> MakePlan(const VideoUpscaleCandidate& candidate, const VideoKey& key);
  API_AVAILABLE(macos(26.0))
  void RequestKit(const Plan& plan);
  API_AVAILABLE(macos(26.0))
  void BuildNextKit();
  API_AVAILABLE(macos(26.0))
  void KitBuilt(uint64_t setup,
                Plan plan,
                std::unique_ptr<KitBox> box,
                base::TimeDelta took);
  base::apple::ScopedCFTypeRef<IOSurfaceRef> TakeOutputSurface(const gfx::Size& size);
  API_AVAILABLE(macos(26.0))
  void Start(const VideoUpscaleCandidate& candidate, const Plan& plan);
  void JobDone(uint64_t operation,
               uint64_t generation,
               std::shared_ptr<Job> job,
               bool ok,
               double gpu_ms,
               double completed_ms,
               float factor);
  void Forget();
  bool HoldsAnything() const;
  void CancelSetup();
  void ArmIdleTeardown();
  void TearDown();

  base::RepeatingClosure on_upscaled_;
  scoped_refptr<base::SequencedTaskRunner> task_runner_;
  uint64_t generation_ = 0;
  bool gate_open_ = false;
  ArdiaVideoUpscalerKit* __strong kit_ = nil;
  std::optional<Plan> kit_failed_;
  std::optional<Plan> kit_plan_;
  std::optional<Plan> kit_requested_;
  uint64_t last_operation_ = 0;
  uint64_t setup_in_flight_ = 0;
  std::shared_ptr<SetupCancel> setup_worker_;
  uint64_t job_in_flight_ = 0;
  IOSurfaceRef job_in_flight_source_ = nullptr;
  int64_t frame_count_ = 0;
  base::apple::ScopedCFTypeRef<IOSurfaceRef> current_source_;
  std::optional<VideoKey> current_key_;
  base::apple::ScopedCFTypeRef<IOSurfaceRef> cache_source_;
  uint32_t cache_seed_ = 0;
  std::optional<VideoKey> cache_key_;
  base::apple::ScopedCFTypeRef<IOSurfaceRef> cache_output_;
  std::vector<base::apple::ScopedCFTypeRef<IOSurfaceRef>> outputs_;
  gfx::Size output_size_;
  std::optional<VideoKey> active_;
  std::optional<VideoKey> disabled_;
  gfx::Size vt_failed_;
  int jobs_ = 0;
  int misses_ = 0;
  base::OneShotTimer idle_timer_;
  base::WeakPtrFactory<Upscaler> weak_factory_{this};
};

}

#endif
