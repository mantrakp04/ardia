// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_picture_in_picture.h"

#import <AppKit/AppKit.h>
#import <objc/runtime.h>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/stringprintf.h"
#include "base/strings/sys_string_conversions.h"
#include "base/time/time.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/views/overlay/video_overlay_window_views.h"
#include "content/public/browser/picture_in_picture_window_controller.h"
#include "content/public/browser/video_picture_in_picture_window_controller.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "ui/gfx/native_ui_types.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_launch_switches.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

namespace {

void Report(base::WeakPtr<content::WebContents> contents, bool active, NSString* kind) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents, bool active,
                        NSString* kind) {
                       if (!contents) {
                         return;
                       }
                       ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents.get())->tab();
                       id<ArdiaCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector
                                     (tab:didChangePictureInPicture:)]) {
                         [delegate tab:tab
                             didChangePictureInPicture:@{
                               @"active" : @(active),
                               @"kind" : kind,
                             }];
                       }
                     },
                     contents, active, kind));
}

bool Background() {
  return BackgroundInstance();
}

}
}

@interface ACInvisibleWindowPin : NSObject
@end

@implementation ACInvisibleWindowPin

- (void)observeValueForKeyPath:(NSString*)keyPath
                      ofObject:(id)object
                        change:(NSDictionary*)change
                       context:(void*)context {
  NSWindow* window = object;
  if (window.alphaValue != 0) {
    window.alphaValue = 0;
  }
}

@end

namespace ardiacore {
namespace {

const void* const kInvisiblePinKey = &kInvisiblePinKey;

void MakeInvisible(NSWindow* window) {
  window.alphaValue = 0;
  window.ignoresMouseEvents = YES;
  if (!objc_getAssociatedObject(window, kInvisiblePinKey)) {
    ACInvisibleWindowPin* pin = [[ACInvisibleWindowPin alloc] init];
    objc_setAssociatedObject(window, kInvisiblePinKey, pin, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [window addObserver:pin forKeyPath:@"alphaValue" options:0 context:nullptr];
  }
}

void HideVideoOverlay(content::WebContents* opener) {
  auto* overlay = static_cast<VideoOverlayWindowViews*>(
      content::PictureInPictureWindowController::GetOrCreateVideoPictureInPictureController(
          opener)
          ->GetWindowForTesting());
  if (overlay) {
    MakeInvisible(overlay->GetNativeWindow().GetNativeNSWindow());
  }
}

class DocumentPipBrowsers : public BrowserCollectionObserver {
 public:
  DocumentPipBrowsers() { observation_.Observe(GlobalBrowserCollection::GetInstance()); }

  void OnBrowserCreated(BrowserWindowInterface* browser) override {
    if (browser->GetType() != BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE ||
        WindowHost::ForBrowser(browser) || !browser->GetWindow()) {
      return;
    }
    MakeInvisible(browser->GetWindow()->GetNativeWindow().GetNativeNSWindow());
  }

 private:
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver> observation_{
      this};
};

class PictureInPictureObserver : public PictureInPictureWindowManager::Observer {
 public:
  void OnEnterPictureInPicture() override {
    PictureInPictureWindowManager* manager = PictureInPictureWindowManager::GetInstance();
    content::WebContents* opener = manager->GetWebContents();
    if (opener_ && opener_.get() != opener) {
      Report(opener_, false, kind_);
    }
    opener_ = opener ? opener->GetWeakPtr() : nullptr;
    if (Background() && opener && !manager->GetChildWebContents()) {
      HideVideoOverlay(opener);
    }
    if (!opener) {
      return;
    }
    kind_ = manager->GetChildWebContents() ? @"document" : @"video";
    if (PictureInPictureTracing()) {
      auto* helper = AutoPictureInPictureTabHelper::FromWebContents(opener);
      TracePictureInPicture(base::StringPrintf(
          "engine: PiP window opened (%s) for %s; Chrome's auto PiP: %d",
          kind_.UTF8String, std::string(opener->GetLastCommittedURL().host()).c_str(),
          helper && helper->IsInAutoPictureInPicture()));
    }
    Report(opener_, true, kind_);
  }

  void OnExitPictureInPicture() override {
    if (PictureInPictureTracing()) {
      NSArray<NSString*>* stack = NSThread.callStackSymbols;
      NSMutableString* frames = [NSMutableString string];
      for (NSUInteger i = 1; i < MIN(stack.count, (NSUInteger)14); i++) {
        NSString* frame = stack[i];
        NSRange at = [frame rangeOfString:@"0x"];
        [frames appendFormat:@"\n    %@", at.location == NSNotFound ? frame : [frame substringFromIndex:at.location]];
      }
      TracePictureInPicture("engine: PiP window closed, by" + base::SysNSStringToUTF8(frames));
    }
    if (!opener_) {
      return;
    }
    Report(opener_, false, kind_);
    opener_ = nullptr;
  }

 private:
  base::WeakPtr<content::WebContents> opener_;
  NSString* __strong kind_ = @"video";
};

}

bool PictureInPictureTracing() {
  static const bool tracing = Traced("pip");
  return tracing;
}

void TracePictureInPicture(const std::string& line) {
  if (!PictureInPictureTracing()) {
    return;
  }
  NSString* text = [NSString stringWithFormat:@"%.3f %s\n", NSDate.date.timeIntervalSince1970,
                                               line.c_str()];
  NSFileHandle* file = [NSFileHandle fileHandleForWritingAtPath:@"/tmp/ac-pip-trace.log"];
  if (!file) {
    [NSFileManager.defaultManager createFileAtPath:@"/tmp/ac-pip-trace.log"
                                          contents:nil
                                        attributes:nil];
    file = [NSFileHandle fileHandleForWritingAtPath:@"/tmp/ac-pip-trace.log"];
  }
  [file seekToEndOfFile];
  [file writeData:[text dataUsingEncoding:NSUTF8StringEncoding]];
  [file closeFile];
}

namespace {

std::string AutoPictureInPictureInputs(content::WebContents* contents) {
  auto* helper = AutoPictureInPictureTabHelper::FromWebContents(contents);
  const GURL& url = contents->GetLastCommittedURL();
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  const ContentSetting setting =
      HostContentSettingsMapFactory::GetForProfile(profile)->GetContentSetting(
          url, url, ContentSettingsType::AUTO_PICTURE_IN_PICTURE);
  scoped_refptr<MediaStreamCaptureIndicator> indicator =
      MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator();
  return base::StringPrintf(
      "host=%s scheme=%s setting=%d registered=%d camera=%d mic=%d userMedia=%d audible=%d "
      "inAutoPiP=%d chromeEntered=%d pipWindowOpen=%d incognito=%d",
      std::string(url.host()).c_str(), std::string(url.scheme()).c_str(), setting,
      helper && helper->HasAutoPictureInPictureBeenRegistered(),
      indicator->IsCapturingVideo(contents), indicator->IsCapturingAudio(contents),
      indicator->IsCapturingUserMedia(contents), contents->IsCurrentlyAudible(),
      helper && helper->IsInAutoPictureInPicture(),
      helper && helper->AreAutoPictureInPicturePreconditionsMet(),
      PictureInPictureWindowManager::GetInstance()->GetWebContents() != nullptr,
      profile->IsOffTheRecord());
}

}

void TraceAutoPictureInPictureInputs(content::WebContents* contents, const char* when) {
  if (PictureInPictureTracing()) {
    TracePictureInPicture(std::string("engine: ") + when + ": " +
                          AutoPictureInPictureInputs(contents));
  }
}

void StartPictureInPictureObserver() {
  static base::NoDestructor<PictureInPictureObserver> observer;
  PictureInPictureWindowManager::GetInstance()->AddObserver(observer.get());
  if (Background()) {
    static base::NoDestructor<DocumentPipBrowsers> documents;
  }
}

}
