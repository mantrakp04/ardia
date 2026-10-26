// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_video_upscaler_internal.h"

#include <cmath>
#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/trace_event/trace_event.h"

namespace ardiacore {

namespace {

constexpr char kShaderSource[] = R"(
#include <metal_stdlib>
using namespace metal;

struct ConvertParams {
  float4x4 matrix;
  float2 origin;
  float2 scale;
  float2 luma_size;
  float2 detail_size;
  float2 detail_offset;
  float2 detail_scale;
  float chroma_scale;
  float use_detail;
};

kernel void ardia_pad(texture2d<half, access::read> src [[texture(0)]],
                      texture2d<half, access::write> dst [[texture(1)]],
                      constant int4& crop [[buffer(0)]],
                      uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= dst.get_width() || gid.y >= dst.get_height()) {
    return;
  }
  int2 p = crop.xy + min(int2(gid), crop.zw - 1);
  dst.write(src.read(uint2(p)), gid);
}

kernel void ardia_yuv_to_rgb(texture2d<float, access::sample> luma [[texture(0)]],
                             texture2d<float, access::sample> chroma [[texture(1)]],
                             texture2d<float, access::sample> detail [[texture(2)]],
                             texture2d<float, access::write> out [[texture(3)]],
                             constant ConvertParams& p [[buffer(0)]],
                             uint2 gid [[thread_position_in_grid]]) {
  if (gid.x >= out.get_width() || gid.y >= out.get_height()) {
    return;
  }
  constexpr sampler s(coord::normalized, filter::linear, address::clamp_to_edge);
  float2 position = (p.origin + (float2(gid) + 0.5) * p.scale) / p.luma_size;
  float y = luma.sample(s, position).r;
  float2 c = chroma.sample(s, position).rg;
  if (p.use_detail > 0.0) {
    float y_detail =
        detail.sample(s, (p.detail_offset + (float2(gid) + 0.5) * p.detail_scale) / p.detail_size).r;
    float saturation = length((c - 128.0 / 255.0) * p.chroma_scale);
    y = mix(y_detail, y, smoothstep(0.30, 0.42, saturation));
  }
  float4 rgb = p.matrix * float4(y, c.x, c.y, 1.0);
  out.write(float4(saturate(rgb.rgb), 1.0), gid);
}
)";

}

}

@implementation ArdiaVideoUpscalerKit
@synthesize device = _device;
@synthesize queue = _queue;
@synthesize pad = _pad;
@synthesize convert = _convert;
@synthesize processor = _processor;
@synthesize configuration = _configuration;
@synthesize paddedInput = _paddedInput;
@synthesize vtOutput = _vtOutput;
@synthesize scaler = _scaler;
@synthesize rgb = _rgb;
- (void)dealloc {
  if (@available(macOS 26.0, *)) {
    if (_processor) {
      [_processor endSession];
    }
  }
  if (_paddedInput) {
    CVPixelBufferRelease(_paddedInput);
  }
  if (_vtOutput) {
    CVPixelBufferRelease(_vtOutput);
  }
}
- (void)setPaddedInput:(CVPixelBufferRef)buffer {
  if (_paddedInput) {
    CVPixelBufferRelease(_paddedInput);
  }
  _paddedInput = buffer ? CVPixelBufferRetain(buffer) : nullptr;
}
- (void)setVtOutput:(CVPixelBufferRef)buffer {
  if (_vtOutput) {
    CVPixelBufferRelease(_vtOutput);
  }
  _vtOutput = buffer ? CVPixelBufferRetain(buffer) : nullptr;
}
@end

namespace ardiacore {

namespace {

API_AVAILABLE(macos(26.0))
CVPixelBufferRef CreateBuffer(int width, int height, NSDictionary* required) {
  NSArray* attribute_list = @[
    required ?: @{}, @{
      (id)kCVPixelBufferIOSurfacePropertiesKey : @{},
      (id)kCVPixelBufferMetalCompatibilityKey : @YES,
    }
  ];
  CFDictionaryRef resolved = nullptr;
  CVPixelBufferCreateResolvedAttributesDictionary(
      nullptr, (__bridge CFArrayRef)attribute_list, &resolved);
  CVPixelBufferRef buffer = nullptr;
  CVPixelBufferCreate(nullptr, width, height,
                      kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, resolved,
                      &buffer);
  if (resolved) {
    CFRelease(resolved);
  }
  return buffer;
}

}

API_AVAILABLE(macos(26.0))
ArdiaVideoUpscalerKit* BuildKit(ArdiaVideoUpscalerKit* previous,
                                const Plan& plan,
                                const SetupCancel& cancel) {
  if (cancel.cancelled) {
    return nil;
  }
  ArdiaVideoUpscalerKit* kit = [[ArdiaVideoUpscalerKit alloc] init];
  kit.device = previous.device ?: MTLCreateSystemDefaultDevice();
  if (!kit.device) {
    return nil;
  }
  kit.queue = previous.queue ?: [kit.device newCommandQueue];
  kit.pad = previous.pad;
  kit.convert = previous.convert;
  if (!kit.pad || !kit.convert) {
    NSError* error = nil;
    id<MTLLibrary> library =
        [kit.device newLibraryWithSource:@(kShaderSource) options:nil error:&error];
    if (!library) {
      return nil;
    }
    kit.pad = [kit.device
        newComputePipelineStateWithFunction:[library newFunctionWithName:@"ardia_pad"]
                                      error:&error];
    kit.convert = [kit.device
        newComputePipelineStateWithFunction:[library newFunctionWithName:@"ardia_yuv_to_rgb"]
                                      error:&error];
    if (!kit.pad || !kit.convert) {
      return nil;
    }
  }
  if (cancel.cancelled) {
    return nil;
  }
  if (plan.vt_factor > 0) {
    if (previous.processor && previous.configuration.frameWidth == plan.vt_input.width() &&
        previous.configuration.frameHeight == plan.vt_input.height() &&
        previous.configuration.scaleFactor == plan.vt_factor) {
      kit.processor = previous.processor;
      kit.configuration = previous.configuration;
      previous.processor = nil;
    } else {
      kit.configuration = [[VTLowLatencySuperResolutionScalerConfiguration alloc]
          initWithFrameWidth:plan.vt_input.width()
                 frameHeight:plan.vt_input.height()
                 scaleFactor:plan.vt_factor];
      kit.processor = [[VTFrameProcessor alloc] init];
      NSError* error = nil;
      if (![kit.processor startSessionWithConfiguration:kit.configuration error:&error]) {
        return nil;
      }
    }
    if (cancel.cancelled) {
      return nil;
    }
    {
      const int out_width = (int)std::lround(plan.vt_input.width() * plan.vt_factor);
      const int out_height = (int)std::lround(plan.vt_input.height() * plan.vt_factor);
      CVPixelBufferRef output = CreateBuffer(
          out_width, out_height, kit.configuration.destinationPixelBufferAttributes);
      kit.vtOutput = output;
      if (output) {
        CVPixelBufferRelease(output);
      }
      if (plan.vt_needs_pad) {
        CVPixelBufferRef padded =
            CreateBuffer(plan.vt_input.width(), plan.vt_input.height(),
                         kit.configuration.sourcePixelBufferAttributes);
        kit.paddedInput = padded;
        if (padded) {
          CVPixelBufferRelease(padded);
        }
      }
      if (!kit.vtOutput || (plan.vt_needs_pad && !kit.paddedInput)) {
        return nil;
      }
    }
  }
  if (cancel.cancelled) {
    return nil;
  }
  if (plan.needs_metalfx) {
    MTLTextureDescriptor* descriptor =
        [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm
                                                           width:plan.rgb_size.width()
                                                          height:plan.rgb_size.height()
                                                       mipmapped:NO];
    descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageShaderWrite;
    descriptor.storageMode = MTLStorageModePrivate;
    kit.rgb = [kit.device newTextureWithDescriptor:descriptor];
    MTLFXSpatialScalerDescriptor* scaler = [[MTLFXSpatialScalerDescriptor alloc] init];
    scaler.colorTextureFormat = MTLPixelFormatRGBA8Unorm;
    scaler.outputTextureFormat = MTLPixelFormatBGRA8Unorm;
    scaler.inputWidth = plan.rgb_size.width();
    scaler.inputHeight = plan.rgb_size.height();
    scaler.outputWidth = plan.key.target.width();
    scaler.outputHeight = plan.key.target.height();
    scaler.colorProcessingMode = MTLFXSpatialScalerColorProcessingModePerceptual;
    kit.scaler = [scaler newSpatialScalerWithDevice:kit.device];
    if (!kit.rgb || !kit.scaler) {
      return nil;
    }
  }
  return kit;
}

API_AVAILABLE(macos(26.0))
void Upscaler::RequestKit(const Plan& plan) {
  if ((kit_requested_ && *kit_requested_ == plan) || (kit_failed_ && *kit_failed_ == plan)) {
    return;
  }
  kit_requested_ = plan;
  if (setup_in_flight_) {
    return;
  }
  BuildNextKit();
}

API_AVAILABLE(macos(26.0))
void Upscaler::BuildNextKit() {
  if (!kit_requested_ || !gate_open_) {
    kit_requested_.reset();
    return;
  }
  if (setup_worker_) {
    return;
  }
  const uint64_t setup = ++last_operation_;
  setup_in_flight_ = setup;
  auto cancel = std::make_shared<SetupCancel>();
  setup_worker_ = cancel;
  const Plan plan = *kit_requested_;
  ArdiaVideoUpscalerKit* previous = kit_;
  kit_ = nil;
  kit_plan_.reset();
  TRACE_EVENT_INSTANT2("gpu", "ArdiaVSR.Setup", TRACE_EVENT_SCOPE_THREAD, "factor",
                       plan.vt_factor, "target", plan.key.target.ToString());
  scoped_refptr<base::SequencedTaskRunner> reply_to = task_runner_;
  base::WeakPtr<Upscaler> weak = weak_factory_.GetWeakPtr();
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    const base::TimeTicks started = base::TimeTicks::Now();
    auto box = std::make_unique<KitBox>();
    box->kit = BuildKit(previous, plan, *cancel);
    const base::TimeDelta took = base::TimeTicks::Now() - started;
    reply_to->PostTask(FROM_HERE, base::BindOnce(&Upscaler::KitBuilt, weak, setup, plan,
                                                 std::move(box), took));
  });
}

API_AVAILABLE(macos(26.0))
void Upscaler::KitBuilt(uint64_t setup,
                        Plan plan,
                        std::unique_ptr<KitBox> box,
                        base::TimeDelta took) {
  setup_worker_.reset();
  if (setup != setup_in_flight_) {
    TRACE_EVENT_INSTANT1("gpu", "ArdiaVSR.SetupDropped", TRACE_EVENT_SCOPE_THREAD, "built",
                         box->kit != nil);
    BuildNextKit();
    return;
  }
  setup_in_flight_ = 0;
  ArdiaVideoUpscalerKit* kit = box->kit;
  if (!gate_open_) {
    kit_requested_.reset();
    return;
  }
  TRACE_EVENT_INSTANT2("gpu", "ArdiaVSR.SetupDone", TRACE_EVENT_SCOPE_THREAD, "ok",
                       kit != nil, "ms", took.InMillisecondsF());
  if (!kit && plan.vt_factor > 0) {
    vt_failed_ = plan.vt_input;
  }
  if (kit_requested_ && !(*kit_requested_ == plan)) {
    kit_ = kit;
    BuildNextKit();
    return;
  }
  kit_requested_.reset();
  if (!kit) {
    kit_failed_ = plan;
    if (plan.vt_factor > 0) {
      on_upscaled_.Run();
    }
    return;
  }
  kit_ = kit;
  kit_plan_ = plan;
  on_upscaled_.Run();
}

}
