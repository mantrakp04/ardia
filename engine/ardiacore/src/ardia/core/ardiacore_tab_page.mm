#import "ardia/core/public/ArdiaCore.h"

#include <cmath>
#include <optional>
#include <string>

#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "components/zoom/page_zoom.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/page_zoom.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_contents_background.h"
#include "ardia/core/ac_page_channel.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

using ardiacore::NS;

@implementation ArdiaCoreTab (Page)

- (double)zoomFactor {
  return _contents ? blink::ZoomLevelToZoomFactor(
                         zoom::ZoomController::GetZoomLevelForWebContents(_contents))
                   : 1;
}

- (void)setZoomFactor:(double)zoomFactor {
  if (!_contents || zoomFactor <= 0) {
    return;
  }
  if (auto* zoom = zoom::ZoomController::FromWebContents(_contents)) {
    zoom->SetZoomLevel(blink::ZoomFactorToZoomLevel(zoomFactor));
  }
}

- (void)zoomStep:(int)direction {
  if (_contents) {
    zoom::PageZoom::Zoom(_contents, direction > 0   ? content::PAGE_ZOOM_IN
                                    : direction < 0 ? content::PAGE_ZOOM_OUT
                                                    : content::PAGE_ZOOM_RESET);
  }
}

- (double)pinchScale {
  return _contents ? ardiacore::TabBridge::GetOrCreate(_contents)->pinch_scale() : 1;
}

- (NSColor*)pageBackgroundColor {
  return _pageBackgroundColor;
}

- (NSString*)pageColor {
  if (!_contents) {
    return nil;
  }
  auto* channel = ardiacore::PageChannel::FromWebContents(_contents);
  return channel && !channel->page_color().empty()
             ? base::SysUTF8ToNSString(channel->page_color())
             : nil;
}

- (void)setPageColor:(NSString*)color {
  if (_contents) {
    ardiacore::PageChannel::GetOrCreate(_contents)->SetPageColor(
        color ? base::SysNSStringToUTF8(color) : std::string());
  }
}

- (void)setPageBackgroundColor:(NSColor*)color {
  _pageBackgroundColor = color;
  if (!_contents) {
    return;
  }
  if (!color) {
    ardiacore::SetHostPageBaseBackgroundColor(_contents, std::nullopt);
    return;
  }
  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  ardiacore::SetHostPageBaseBackgroundColor(
      _contents, SkColorSetARGB(rgb.alphaComponent * 255, rgb.redComponent * 255,
                                rgb.greenComponent * 255, rgb.blueComponent * 255));
}

- (NSColor*)contentsBackgroundColor {
  std::optional<SkColor> color =
      _contents ? ardiacore::ContentsBackgroundColor(_contents) : std::nullopt;
  return color ? [NSColor colorWithSRGBRed:SkColorGetR(*color) / 255.0
                                     green:SkColorGetG(*color) / 255.0
                                      blue:SkColorGetB(*color) / 255.0
                                     alpha:1]
               : nil;
}

- (void)setContentsBackgroundColor:(NSColor*)color {
  if (!_contents) {
    return;
  }
  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  ardiacore::SetContentsBackgroundColor(
      _contents, rgb ? std::optional<SkColor>(SkColorSetRGB(std::lround(rgb.redComponent * 255),
                                                            std::lround(rgb.greenComponent * 255),
                                                            std::lround(rgb.blueComponent * 255)))
                     : std::nullopt);
}

- (void)executeJavaScript:(NSString*)code frame:(NSString*)frameId {
  if (!_contents) {
    return;
  }
  ardiacore::EndAheadBlank(_contents);
  ardiacore::PageChannel* channel =
      ardiacore::PageChannel::GetOrCreate(_contents);
  if (frameId) {
    channel->ExecuteInFrame(base::SysNSStringToUTF8(frameId),
                            base::SysNSStringToUTF8(code));
  } else {
    channel->Execute(base::SysNSStringToUTF8(code));
  }
}

- (void)evaluate:(NSString*)code completion:(void (^)(NSString*))completion {
  if (!_contents) {
    completion(nil);
    return;
  }
  ardiacore::EndAheadBlank(_contents);
  ardiacore::PageChannel::GetOrCreate(_contents)->Evaluate(
      base::SysNSStringToUTF8(code),
      base::BindOnce(
          [](void (^completion)(NSString*), const std::optional<std::string>& json) {
            completion(json ? NS(*json) : nil);
          },
          completion));
}

- (BOOL)hasLiveFrame:(NSString*)frameId {
  return _contents && (!frameId.length ||
                       ardiacore::PageChannel::GetOrCreate(_contents)->HasFrame(
                           base::SysNSStringToUTF8(frameId)));
}

- (void)callPage:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->CallPage(
        base::SysNSStringToUTF8(kind), base::SysNSStringToUTF8(json));
  }
}

- (void)grantUserActivationToFrame:(NSString*)frameId {
  if (_contents) {
    ardiacore::PageChannel::GetOrCreate(_contents)->GrantUserActivation(
        base::SysNSStringToUTF8(frameId));
  }
}

- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->CallFrame(
        base::SysNSStringToUTF8(frameId), base::SysNSStringToUTF8(kind),
        base::SysNSStringToUTF8(json));
  }
}

@end
