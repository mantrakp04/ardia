// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_video_upscaler_internal.h"

#include <string>
#include <utility>

#include "base/apple/bridging.h"
#include "base/strings/sys_string_conversions.h"

namespace ardiacore {

std::optional<std::pair<float, float>> LumaWeights(IOSurfaceRef surface,
                                                   const gfx::ColorSpace& space) {
  base::apple::ScopedCFTypeRef<CFTypeRef> tag(
      IOSurfaceCopyValue(surface, CFSTR("IOSurfaceYCbCrMatrix")));
  if (tag && CFGetTypeID(tag.get()) == CFStringGetTypeID()) {
    CFStringRef name = static_cast<CFStringRef>(tag.get());
    if (CFEqual(name, kCVImageBufferYCbCrMatrix_ITU_R_709_2)) {
      return std::make_pair(0.2126f, 0.0722f);
    }
    if (CFEqual(name, kCVImageBufferYCbCrMatrix_ITU_R_601_4)) {
      return std::make_pair(0.299f, 0.114f);
    }
    if (CFEqual(name, kCVImageBufferYCbCrMatrix_SMPTE_240M_1995)) {
      return std::make_pair(0.212f, 0.087f);
    }
    if (CFEqual(name, kCVImageBufferYCbCrMatrix_ITU_R_2020)) {
      return std::make_pair(0.2627f, 0.0593f);
    }
    return std::nullopt;
  }
  switch (space.GetMatrixID()) {
    case gfx::ColorSpace::MatrixID::BT709:
    case gfx::ColorSpace::MatrixID::INVALID:
      return std::make_pair(0.2126f, 0.0722f);
    case gfx::ColorSpace::MatrixID::SMPTE170M:
    case gfx::ColorSpace::MatrixID::BT470BG:
      return std::make_pair(0.299f, 0.114f);
    case gfx::ColorSpace::MatrixID::SMPTE240M:
      return std::make_pair(0.212f, 0.087f);
    case gfx::ColorSpace::MatrixID::BT2020_NCL:
      return std::make_pair(0.2627f, 0.0593f);
    default:
      return std::nullopt;
  }
}

simd_float4x4 YuvToRgbMatrix(float kr, float kb, bool full_range) {
  const float kg = 1.0f - kr - kb;
  const float y_scale = full_range ? 1.0f : 255.0f / 219.0f;
  const float y_offset = full_range ? 0.0f : -16.0f / 219.0f;
  const float c_scale = full_range ? 1.0f : 255.0f / 224.0f;
  const float c_offset = -128.0f / 255.0f * c_scale;
  const float r_cr = 2.0f * (1.0f - kr);
  const float b_cb = 2.0f * (1.0f - kb);
  const float g_cb = -2.0f * kb * (1.0f - kb) / kg;
  const float g_cr = -2.0f * kr * (1.0f - kr) / kg;
  simd_float4 col_y = {y_scale, y_scale, y_scale, 0};
  simd_float4 col_cb = {0, g_cb * c_scale, b_cb * c_scale, 0};
  simd_float4 col_cr = {r_cr * c_scale, g_cr * c_scale, 0, 0};
  simd_float4 col_one = {y_offset + r_cr * c_offset,
                         y_offset + (g_cb + g_cr) * c_offset,
                         y_offset + b_cb * c_offset, 1};
  return simd_matrix(col_y, col_cb, col_cr, col_one);
}

void CopyColorTags(IOSurfaceRef from, IOSurfaceRef to, const gfx::ColorSpace& space) {
  base::apple::ScopedCFTypeRef<CFTypeRef> named(
      IOSurfaceCopyValue(from, CFSTR("IOSurfaceColorSpace")));
  if (named) {
    IOSurfaceSetValue(to, CFSTR("IOSurfaceColorSpace"), named.get());
    return;
  }
  NSMutableDictionary* attachments = [NSMutableDictionary dictionary];
  const std::pair<CFStringRef, CFStringRef> keys[] = {
      {CFSTR("IOSurfaceColorPrimaries"), kCVImageBufferColorPrimariesKey},
      {CFSTR("IOSurfaceTransferFunction"), kCVImageBufferTransferFunctionKey},
      {CFSTR("IOSurfaceYCbCrMatrix"), kCVImageBufferYCbCrMatrixKey},
  };
  for (const auto& [surface_key, buffer_key] : keys) {
    base::apple::ScopedCFTypeRef<CFTypeRef> value(IOSurfaceCopyValue(from, surface_key));
    if (value) {
      attachments[(__bridge NSString*)buffer_key] = (__bridge id)value.get();
    }
  }
  if (attachments.count) {
    base::apple::ScopedCFTypeRef<CGColorSpaceRef> color_space(
        CVImageBufferCreateColorSpaceFromAttachments((__bridge CFDictionaryRef)attachments));
    if (color_space) {
      base::apple::ScopedCFTypeRef<CFPropertyListRef> list(
          CGColorSpaceCopyPropertyList(color_space.get()));
      if (list) {
        IOSurfaceSetValue(to, CFSTR("IOSurfaceColorSpace"), list.get());
        return;
      }
    }
  }
  gfx::IOSurfaceSetColorSpace(to, space.GetAsFullRangeRGB());
}

std::string SurfaceTags(IOSurfaceRef surface) {
  std::string tags;
  for (CFStringRef key : {CFSTR("IOSurfaceColorSpace"), CFSTR("IOSurfaceColorPrimaries"),
                          CFSTR("IOSurfaceTransferFunction"), CFSTR("IOSurfaceYCbCrMatrix"),
                          CFSTR("IOSurfaceICCProfile")}) {
    base::apple::ScopedCFTypeRef<CFTypeRef> value(IOSurfaceCopyValue(surface, key));
    if (!value) {
      continue;
    }
    base::apple::ScopedCFTypeRef<CFStringRef> text(CFCopyDescription(value.get()));
    tags += base::SysCFStringRefToUTF8(key) + "=" +
            (CFGetTypeID(value.get()) == CFDataGetTypeID() ? std::string("data")
                                                             : base::SysCFStringRefToUTF8(text.get())) +
            " ";
  }
  return tags;
}

}
