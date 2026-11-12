// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_video_upscaler_internal.h"

#include <memory>
#include <utility>

#include "base/apple/bridging.h"
#include "base/functional/bind.h"
#include "base/trace_event/trace_event.h"

namespace ardiacore {

namespace {

constexpr size_t kMaxOutputSurfaces = 4;
constexpr int kMissWindow = 12;
constexpr int kMissLimit = 6;

struct ConvertParams {
  simd_float4x4 matrix;
  simd_float2 origin;
  simd_float2 scale;
  simd_float2 luma_size;
  simd_float2 detail_size;
  simd_float2 detail_offset;
  simd_float2 detail_scale;
  float chroma_scale;
  float use_detail;
};

id<MTLTexture> PlaneTexture(id<MTLDevice> device,
                            IOSurfaceRef surface,
                            size_t plane,
                            MTLPixelFormat format,
                            MTLTextureUsage usage) {
  MTLTextureDescriptor* descriptor = [MTLTextureDescriptor
      texture2DDescriptorWithPixelFormat:format
                                   width:IOSurfaceGetWidthOfPlane(surface, plane)
                                  height:IOSurfaceGetHeightOfPlane(surface, plane)
                               mipmapped:NO];
  descriptor.usage = usage;
  descriptor.storageMode = MTLStorageModeShared;
  return [device newTextureWithDescriptor:descriptor iosurface:surface plane:plane];
}

bool SameRowStrides(IOSurfaceRef surface, IOSurfaceRef reference) {
  for (size_t plane = 0; plane < 2; ++plane) {
    if (IOSurfaceGetBytesPerRowOfPlane(surface, plane) !=
        IOSurfaceGetBytesPerRowOfPlane(reference, plane)) {
      return false;
    }
  }
  return true;
}

base::apple::ScopedCFTypeRef<IOSurfaceRef> CreateOutputSurface(const gfx::Size& size) {
  const size_t bytes_per_row =
      IOSurfaceAlignProperty(kIOSurfaceBytesPerRow, size.width() * 4);
  NSDictionary* properties = @{
    (id)kIOSurfaceWidth : @(size.width()),
    (id)kIOSurfaceHeight : @(size.height()),
    (id)kIOSurfaceBytesPerElement : @4,
    (id)kIOSurfaceBytesPerRow : @(bytes_per_row),
    (id)kIOSurfaceAllocSize : @(IOSurfaceAlignProperty(kIOSurfaceAllocSize,
                                                       bytes_per_row * size.height())),
    (id)kIOSurfacePixelFormat : @(kCVPixelFormatType_32BGRA),
  };
  return base::apple::ScopedCFTypeRef<IOSurfaceRef>(
      IOSurfaceCreate((__bridge CFDictionaryRef)properties));
}

std::atomic<bool> g_video_toolbox_quarantined{false};

API_AVAILABLE(macos(26.0))
NSMutableArray<VTFrameProcessor*>* QuarantinedProcessors() {
  static NSMutableArray<VTFrameProcessor*>* processors = [[NSMutableArray alloc] init];
  return processors;
}

id<MTLTexture> EncodeConvert(ArdiaVideoUpscalerKit* kit,
                             id<MTLCommandBuffer> buffer,
                             IOSurfaceRef source,
                             IOSurfaceRef detail_source,
                             id<MTLTexture> target,
                             ConvertParams params) {
  id<MTLComputeCommandEncoder> encoder = [buffer computeCommandEncoder];
  [encoder setComputePipelineState:kit.convert];
  id<MTLTexture> luma =
      PlaneTexture(kit.device, source, 0, MTLPixelFormatR8Unorm, MTLTextureUsageShaderRead);
  id<MTLTexture> chroma =
      PlaneTexture(kit.device, source, 1, MTLPixelFormatRG8Unorm, MTLTextureUsageShaderRead);
  id<MTLTexture> detail = detail_source ? PlaneTexture(kit.device, detail_source, 0,
                                                       MTLPixelFormatR8Unorm,
                                                       MTLTextureUsageShaderRead)
                                        : luma;
  params.luma_size = simd_make_float2(luma.width, luma.height);
  params.detail_size = simd_make_float2(detail.width, detail.height);
  [encoder setTexture:luma atIndex:0];
  [encoder setTexture:chroma atIndex:1];
  [encoder setTexture:detail atIndex:2];
  [encoder setTexture:target atIndex:3];
  [encoder setBytes:&params length:sizeof(params) atIndex:0];
  [encoder dispatchThreads:MTLSizeMake(target.width, target.height, 1)
      threadsPerThreadgroup:MTLSizeMake(16, 16, 1)];
  [encoder endEncoding];
  return target;
}

void EncodePad(ArdiaVideoUpscalerKit* kit,
               id<MTLCommandBuffer> buffer,
               IOSurfaceRef source,
               IOSurfaceRef padded,
               const gfx::Rect& region) {
  id<MTLComputeCommandEncoder> encoder = [buffer computeCommandEncoder];
  [encoder setComputePipelineState:kit.pad];
  for (size_t plane = 0; plane < 2; ++plane) {
    const MTLPixelFormat format = plane ? MTLPixelFormatRG8Unorm : MTLPixelFormatR8Unorm;
    id<MTLTexture> from =
        PlaneTexture(kit.device, source, plane, format, MTLTextureUsageShaderRead);
    id<MTLTexture> to =
        PlaneTexture(kit.device, padded, plane, format, MTLTextureUsageShaderWrite);
    const int divisor = plane ? 2 : 1;
    simd_int4 crop = {region.x() / divisor, region.y() / divisor,
                      (region.width() + divisor - 1) / divisor,
                      (region.height() + divisor - 1) / divisor};
    [encoder setTexture:from atIndex:0];
    [encoder setTexture:to atIndex:1];
    [encoder setBytes:&crop length:sizeof(crop) atIndex:0];
    [encoder dispatchThreads:MTLSizeMake(to.width, to.height, 1)
        threadsPerThreadgroup:MTLSizeMake(16, 16, 1)];
  }
  [encoder endEncoding];
}

API_AVAILABLE(macos(26.0))
bool SubmitSuperResolution(ArdiaVideoUpscalerKit* kit,
                           VTLowLatencySuperResolutionScalerParameters* parameters,
                           void (^processed)(bool ok)) {
  VTFrameProcessor* processor = kit.processor;
  if (!processor || g_video_toolbox_quarantined || kit.processorQuarantined) {
    return false;
  }
  @try {
    [processor processWithParameters:parameters
                   completionHandler:^(id<VTFrameProcessorParameters> result, NSError* error) {
                     processed(error == nil);
                   }];
    return true;
  } @catch (id exception) {
    kit.processorQuarantined = YES;
    g_video_toolbox_quarantined = true;
    TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.VideoToolboxQuarantined", TRACE_EVENT_SCOPE_THREAD);
    return false;
  }
}

}

bool VideoToolboxQuarantined() {
  return g_video_toolbox_quarantined;
}

API_AVAILABLE(macos(26.0))
void KeepQuarantinedProcessor(VTFrameProcessor* processor) {
  NSMutableArray<VTFrameProcessor*>* processors = QuarantinedProcessors();
  @synchronized(processors) {
    [processors addObject:processor];
  }
}

base::apple::ScopedCFTypeRef<IOSurfaceRef> Upscaler::TakeOutputSurface(const gfx::Size& size) {
  if (output_size_ != size) {
    outputs_.clear();
    output_size_ = size;
  }
  for (auto& surface : outputs_) {
    if (!IOSurfaceIsInUse(surface.get()) && surface != cache_output_) {
      return surface;
    }
  }
  if (outputs_.size() >= kMaxOutputSurfaces) {
    return base::apple::ScopedCFTypeRef<IOSurfaceRef>();
  }
  outputs_.push_back(CreateOutputSurface(size));
  return outputs_.back();
}

void Upscaler::AbandonStalledJob() {
  TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.JobStalled", TRACE_EVENT_SCOPE_THREAD);
  if (kit_plan_ && kit_plan_->vt_factor > 0) {
    vt_failed_ = kit_plan_->vt_input;
  }
  job_in_flight_ = 0;
  job_in_flight_source_ = nullptr;
  kit_ = nil;
  kit_plan_.reset();
}

API_AVAILABLE(macos(26.0))
void Upscaler::Start(const VideoUpscaleCandidate& candidate, const Plan& plan) {
  const base::TimeTicks begin = base::TimeTicks::Now();
  base::apple::ScopedCFTypeRef<IOSurfaceRef> output = TakeOutputSurface(plan.key.target);
  if (!output) {
    return;
  }
  ArdiaVideoUpscalerKit* kit = kit_;
  IOSurfaceRef source = candidate.source;
  CopyColorTags(source, output.get(), candidate.color_space);
  const auto weights = *LumaWeights(source, candidate.color_space);
  const bool full_range =
      plan.key.format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;

  id<MTLTexture> output_texture =
      PlaneTexture(kit.device, output.get(), 0, MTLPixelFormatBGRA8Unorm,
                   MTLTextureUsageShaderWrite | MTLTextureUsageRenderTarget |
                       MTLTextureUsageShaderRead);
  id<MTLTexture> convert_target = plan.needs_metalfx ? kit.rgb : output_texture;
  const bool video_toolbox = plan.vt_factor > 0;
  const float factor = video_toolbox ? plan.vt_factor : 1.0f;

  ConvertParams params = {};
  params.matrix = YuvToRgbMatrix(weights.first, weights.second, full_range);
  params.origin = simd_make_float2(plan.key.crop.x(), plan.key.crop.y());
  params.scale = simd_make_float2(plan.key.crop.width() / (float)convert_target.width,
                                  plan.key.crop.height() / (float)convert_target.height);
  const gfx::PointF region_origin =
      plan.vt_needs_pad ? gfx::PointF(plan.region.origin()) : gfx::PointF();
  params.detail_offset = simd_make_float2((plan.key.crop.x() - region_origin.x()) * factor,
                                          (plan.key.crop.y() - region_origin.y()) * factor);
  params.detail_scale =
      simd_make_float2(plan.key.crop.width() * factor / convert_target.width,
                       plan.key.crop.height() * factor / convert_target.height);
  params.chroma_scale = full_range ? 1.0f : 255.0f / 224.0f;
  params.use_detail = video_toolbox ? 1.0f : 0.0f;

  id<MTLCommandBuffer> pad_buffer = nil;
  VTLowLatencySuperResolutionScalerParameters* parameters = nil;
  IOSurfaceRef detail_source = nullptr;
  if (video_toolbox) {
    IOSurfaceRef padded = CVPixelBufferGetIOSurface(kit.paddedInput);
    CVPixelBufferRef vt_input = nullptr;
    if (plan.vt_needs_pad || !SameRowStrides(source, padded)) {
      pad_buffer = [kit.queue commandBuffer];
      if (!pad_buffer) {
        return;
      }
      EncodePad(kit, pad_buffer, source, padded, plan.region);
      vt_input = CVPixelBufferRetain(kit.paddedInput);
    } else {
      CVPixelBufferCreateWithIOSurface(nullptr, source, nullptr, &vt_input);
    }
    if (!vt_input) {
      return;
    }
    VTFrameProcessorFrame* in_frame =
        [[VTFrameProcessorFrame alloc] initWithBuffer:vt_input
                                presentationTimeStamp:CMTimeMake(frame_count_, 30)];
    VTFrameProcessorFrame* out_frame =
        [[VTFrameProcessorFrame alloc] initWithBuffer:kit.vtOutput
                                presentationTimeStamp:CMTimeMake(frame_count_, 30)];
    CVPixelBufferRelease(vt_input);
    if (!in_frame || !out_frame) {
      return;
    }
    parameters =
        [[VTLowLatencySuperResolutionScalerParameters alloc] initWithSourceFrame:in_frame
                                                                destinationFrame:out_frame];
    if (!parameters) {
      return;
    }
    detail_source = CVPixelBufferGetIOSurface(kit.vtOutput);
  }

  auto job = std::make_shared<Job>();
  job->source.reset(source, base::scoped_policy::RETAIN);
  job->seed = IOSurfaceGetSeed(source);
  job->key = plan.key;
  job->output.reset(output.get(), base::scoped_policy::RETAIN);
  job->started = begin;
  job->encode = base::TimeTicks::Now() - begin;
  const uint64_t operation = ++last_operation_;
  job_in_flight_ = operation;
  job_in_flight_source_ = source;
  job_in_flight_started_ = begin;
  ++frame_count_;
  const uint64_t generation = generation_;
  const float reported_factor = plan.vt_factor;
  const bool needs_metalfx = plan.needs_metalfx;
  const gfx::Size rgb_size = plan.rgb_size;
  scoped_refptr<base::SequencedTaskRunner> reply_to = task_runner_;
  base::WeakPtr<Upscaler> weak = weak_factory_.GetWeakPtr();
  auto finished = std::make_shared<std::atomic<bool>>(false);

  void (^finish)(bool, double) = ^(bool ok, double gpu_ms) {
    if (finished->exchange(true)) {
      return;
    }
    const double completed_ms = (base::TimeTicks::Now() - job->started).InMillisecondsF();
    (void)kit;
    reply_to->PostTask(FROM_HERE, base::BindOnce(&Upscaler::JobDone, weak, operation,
                                                 generation, job, ok, gpu_ms, completed_ms,
                                                 reported_factor));
  };

  void (^convert)(bool) = ^(bool detail_ok) {
    if (!detail_ok) {
      finish(false, 0);
      return;
    }
    id<MTLCommandBuffer> buffer = [kit.queue commandBuffer];
    if (!buffer) {
      finish(false, 0);
      return;
    }
    EncodeConvert(kit, buffer, job->source.get(), detail_source, convert_target, params);
    if (needs_metalfx) {
      kit.scaler.colorTexture = kit.rgb;
      kit.scaler.outputTexture = output_texture;
      kit.scaler.inputContentWidth = rgb_size.width();
      kit.scaler.inputContentHeight = rgb_size.height();
      [kit.scaler encodeToCommandBuffer:buffer];
    }
    [buffer addCompletedHandler:^(id<MTLCommandBuffer> completed) {
      finish(completed.status == MTLCommandBufferStatusCompleted,
             (completed.GPUEndTime - completed.GPUStartTime) * 1000);
    }];
    [buffer commit];
  };

  if (!video_toolbox) {
    convert(true);
    return;
  }

  void (^super_resolve)(void) = ^{
    const bool submitted = SubmitSuperResolution(kit, parameters, ^(bool ok) {
      if (!ok) {
        TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.VideoToolboxError", TRACE_EVENT_SCOPE_THREAD);
      }
      convert(ok);
    });
    if (!submitted) {
      convert(false);
    }
  };

  if (!pad_buffer) {
    super_resolve();
    return;
  }
  [pad_buffer addCompletedHandler:^(id<MTLCommandBuffer> completed) {
    if (completed.status != MTLCommandBufferStatusCompleted) {
      finish(false, 0);
      return;
    }
    super_resolve();
  }];
  [pad_buffer commit];
}


void Upscaler::JobDone(uint64_t operation,
                       uint64_t generation,
                       std::shared_ptr<Job> job,
                       bool ok,
                       double gpu_ms,
                       double completed_ms,
                       float factor) {
  const bool in_flight = operation == job_in_flight_;
  if (in_flight) {
    job_in_flight_ = 0;
    job_in_flight_source_ = nullptr;
  }
  const base::TimeDelta took = base::TimeTicks::Now() - job->started;
  TRACE_EVENT_INSTANT("gpu", "ArdiaVSR.Job", "ok", ok, "factor", factor, "ms",
                      took.InMillisecondsF(), "gpu_ms", gpu_ms, "completed_ms", completed_ms, "encode_ms",
                      job->encode.InMillisecondsF(),
                      "source",
                      job->key.crop.size().ToString(), "target", job->key.target.ToString(),
                      "tags", SurfaceTags(job->source.get()), "space",
                      job->key.color_space.ToString());
  if (generation != generation_ || !in_flight) {
    return;
  }
  if (!ok) {
    if (factor > 0) {
      vt_failed_ = kit_plan_ ? kit_plan_->vt_input : gfx::Size();
      kit_plan_.reset();
      on_upscaled_.Run();
    }
    return;
  }
  const bool current = current_source_.get() == job->source.get() && current_key_ &&
                       *current_key_ == job->key;
  cache_source_.reset(job->source.get(), base::scoped_policy::RETAIN);
  cache_seed_ = job->seed;
  cache_key_ = job->key;
  cache_output_.reset(job->output.get(), base::scoped_policy::RETAIN);
  ++jobs_;
  if (!current) {
    ++misses_;
    TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.Miss", TRACE_EVENT_SCOPE_THREAD);
  }
  if (jobs_ >= kMissWindow) {
    if (misses_ >= kMissLimit) {
      disabled_ = job->key;
      TRACE_EVENT_INSTANT0("gpu", "ArdiaVSR.DisabledForVideo", TRACE_EVENT_SCOPE_THREAD);
    }
    jobs_ = 0;
    misses_ = 0;
  }
  on_upscaled_.Run();
}

}
