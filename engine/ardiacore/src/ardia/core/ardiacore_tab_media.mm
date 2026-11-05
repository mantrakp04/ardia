#import "ardia/core/public/ArdiaCore.h"

#include <optional>
#include <string>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/tab_sharing/tab_sharing_infobar_delegate.h"
#include "components/infobars/content/content_infobar_manager.h"
#include "components/infobars/core/infobar.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_media_capture_id.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColorSpace.h"
#include "third_party/skia/include/core/SkData.h"
#include "third_party/skia/include/encode/SkICC.h"
#include "third_party/skia/modules/skcms/skcms.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "url/gurl.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_device_chooser.h"
#include "ardia/core/ac_host_visibility.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_picture_in_picture.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

using ardiacore::NS;

namespace {

CGImageRef CreatePicture(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing() || bitmap.bytesPerPixel() != 4 ||
      (bitmap.colorType() != kBGRA_8888_SkColorType &&
       bitmap.colorType() != kRGBA_8888_SkColorType)) {
    return nullptr;
  }
  const bool opaque = bitmap.alphaType() == kOpaque_SkAlphaType;
  const CGBitmapInfo info =
      bitmap.colorType() == kBGRA_8888_SkColorType
          ? kCGBitmapByteOrder32Little |
                (opaque ? kCGImageAlphaNoneSkipFirst : kCGImageAlphaPremultipliedFirst)
          : kCGBitmapByteOrder32Big |
                (opaque ? kCGImageAlphaNoneSkipLast : kCGImageAlphaPremultipliedLast);
  CGColorSpaceRef space = nullptr;
  if (SkColorSpace* sk = bitmap.colorSpace()) {
    skcms_TransferFunction fn;
    skcms_Matrix3x3 toXYZD50;
    if (sk->isNumericalTransferFn(&fn) && sk->toXYZD50(&toXYZD50)) {
      if (sk_sp<SkData> icc = SkWriteICCProfile(fn, toXYZD50)) {
        CFDataRef data = CFDataCreate(nullptr, icc->bytes(), icc->size());
        space = CGColorSpaceCreateWithICCData(data);
        CFRelease(data);
      }
    }
  }
  if (!space) {
    space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  }
  CFDataRef pixels = CFDataCreate(nullptr, static_cast<const UInt8*>(bitmap.getPixels()),
                                  bitmap.computeByteSize());
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(pixels);
  CGImageRef image = CGImageCreate(bitmap.width(), bitmap.height(), 8, 32, bitmap.rowBytes(),
                                   space, info, provider, nullptr, false,
                                   kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CFRelease(pixels);
  CGColorSpaceRelease(space);
  return image;
}

TabSharingInfoBarDelegate* TabSharingDelegateFor(content::WebContents* contents,
                                                 content::WebContents* capturer) {
  auto* manager =
      contents ? infobars::ContentInfoBarManager::FromWebContents(contents) : nullptr;
  if (!manager || !capturer) {
    return nullptr;
  }
  TabSharingInfoBarDelegate* found = nullptr;
  for (infobars::InfoBar* infobar : manager->infobars()) {
    if (infobar->delegate()->GetIdentifier() !=
        infobars::InfoBarDelegate::TAB_SHARING_INFOBAR_DELEGATE) {
      continue;
    }
    auto* sharing = static_cast<TabSharingInfoBarDelegate*>(infobar->delegate());
    content::RenderFrameHost* frame =
        content::RenderFrameHost::FromID(sharing->capturer_id());
    if (frame && content::WebContents::FromRenderFrameHost(frame) == capturer) {
      if (found) {
        return nullptr;
      }
      found = sharing;
    }
  }
  return found;
}

}

@implementation ArdiaCoreTab (Media)

- (NSString*)mediaCaptureSourceId {
  content::RenderFrameHost* frame =
      _contents ? _contents->GetPrimaryMainFrame() : nullptr;
  if (!frame || !frame->IsRenderFrameLive()) {
    return nil;
  }
  return NS(content::WebContentsMediaCaptureId(frame->GetProcess()->GetDeprecatedID(),
                                               frame->GetRoutingID())
                .ToString());
}

- (void)copyPicture:(NSTimeInterval)timeout completion:(void (^)(CGImageRef))completion {
  content::RenderWidgetHostView* view =
      _contents ? _contents->GetRenderWidgetHostView() : nullptr;
  if (!view || !view->IsSurfaceAvailableForCopy()) {
    completion(nullptr);
    return;
  }
  void (^done)(CGImageRef) = [completion copy];
  view->CopyFromSurface(
      gfx::Rect(), gfx::Size(), base::Seconds(timeout),
      base::BindOnce(^(const content::CopyFromSurfaceResult& result) {
        CGImageRef image = result.has_value() ? CreatePicture(result->bitmap) : nullptr;
        content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(^{
                                                       done(image);
                                                       if (image) {
                                                         CGImageRelease(image);
                                                       }
                                                     }));
      }));
}

- (BOOL)stopCapture {
  if (!_contents) {
    return NO;
  }
  scoped_refptr<MediaStreamCaptureIndicator> indicator =
      MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator();
  const bool capturing = indicator->IsCapturingTab(_contents) ||
                         indicator->IsCapturingWindow(_contents) ||
                         indicator->IsCapturingDisplay(_contents);
  indicator->StopMediaCapturing(_contents,
                                MediaStreamCaptureIndicator::MediaType::kDisplayMedia);
  return capturing;
}

- (void)noteShownByHost:(BOOL)shown {
  if (_contents) {
    ardiacore::NoteTabShownByHost(_contents, shown);
  }
}

- (void)exitFullscreen {
  if (_contents && _contents->IsFullscreen()) {
    _contents->ExitFullscreen(true);
  }
}

- (void)exitExclusiveAccess {
  if (!_contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  ExclusiveAccessManager* manager =
      browser ? ExclusiveAccessManager::From(browser) : nullptr;
  if (manager) {
    manager->OnTabDeactivated(_contents);
  }
}

- (void)tracePictureInPicture:(NSString*)line withInputs:(BOOL)withInputs {
  if (!ardiacore::PictureInPictureTracing()) {
    return;
  }
  if (withInputs && _contents) {
    ardiacore::TraceAutoPictureInPictureInputs(_contents, line.UTF8String);
  } else {
    ardiacore::TracePictureInPicture(base::SysNSStringToUTF8(line));
  }
}

- (BOOL)showCastDialog {
  return ardiacore::ShowCastDialog(_contents);
}

- (BOOL)devShowBluetoothChooser:(BOOL)unauthorized {
  return ardiacore::ShowTestBluetoothChooser(_contents, unauthorized);
}

- (BOOL)canShareThisTabInsteadFor:(ArdiaCoreTab*)capturer {
  TabSharingInfoBarDelegate* sharing =
      TabSharingDelegateFor(_contents, capturer.contents);
  return sharing &&
         (sharing->GetButtons() & TabSharingInfoBarDelegate::kShareThisTabInstead) &&
         sharing->IsButtonEnabled(TabSharingInfoBarDelegate::kShareThisTabInstead);
}

- (BOOL)shareThisTabInsteadFor:(ArdiaCoreTab*)capturer {
  if (![self canShareThisTabInsteadFor:capturer]) {
    return NO;
  }
  TabSharingDelegateFor(_contents, capturer.contents)->ShareThisTabInstead();
  return YES;
}

- (void)enterPictureInPictureForClickAt:(NSTimeInterval)clickTime
                             completion:(void (^)(NSString* route, BOOL opened))completion {
  if (!_contents) {
    completion(@"none", NO);
    return;
  }
  const ardiacore::PictureInPictureRoute route =
      ardiacore::PageChannel::GetOrCreate(_contents)->EnterPictureInPictureForClick(
          clickTime > 0 ? std::optional<base::TimeTicks>(base::TimeTicks() +
                                                         base::Seconds(clickTime))
                        : std::nullopt,
          base::BindOnce(
              [](void (^completion)(NSString*, BOOL), bool opened) {
                completion(@"element", opened);
              },
              completion));
  if (route == ardiacore::PictureInPictureRoute::kMediaSession) {
    completion(@"session", NO);
  } else if (route == ardiacore::PictureInPictureRoute::kNone) {
    completion(@"none", NO);
  }
}

- (void)exitPictureInPicture {
  if (!_contents) {
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents) {
                       PictureInPictureWindowManager* manager =
                           PictureInPictureWindowManager::GetInstance();
                       if (contents && manager->GetWebContents() == contents.get()) {
                         manager->ExitPictureInPicture();
                       }
                     },
                     _contents->GetWeakPtr()));
}

@end
