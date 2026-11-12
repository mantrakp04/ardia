// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_picture_in_picture.h"

#import <AppKit/AppKit.h>
#import <objc/runtime.h>

#include <deque>
#include <optional>
#include <string>

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
#include "ardia/core/ac_host_visibility.h"
#include "ardia/core/ac_launch_switches.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

namespace {

void Report(base::WeakPtr<content::WebContents> contents,
            bool active,
            NSString* kind,
            NSString* closed_by = nil,
            bool auto_pip = false) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents, bool active,
                        NSString* kind, NSString* closed_by, bool auto_pip) {
                       if (!contents) {
                         return;
                       }
                       ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents.get())->tab();
                       id<ArdiaCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector
                                     (tab:didChangePictureInPicture:)]) {
                         NSMutableDictionary* state = [@{
                           @"active" : @(active),
                           @"kind" : kind,
                         } mutableCopy];
                         if (closed_by) {
                           state[@"closedBy"] = closed_by;
                           state[@"auto"] = @(auto_pip);
                         }
                         [delegate tab:tab didChangePictureInPicture:state];
                       }
                     },
                     contents, active, kind, closed_by, auto_pip));
}

bool Background() {
  return BackgroundInstance();
}

constexpr size_t kActivationNoteLimit = 4;
constexpr size_t kCloseRecordLimit = 8;
constexpr base::TimeDelta kExitRequestWindow = base::Seconds(2);

struct ActivationNote {
  std::string change;
  long window = 0;
  base::TimeTicks at;
};

struct CloseRecordState {
  std::deque<ActivationNote> activations;
  std::deque<std::string> records;
  base::TimeTicks exit_requested_at;
  int closes = 0;
};

CloseRecordState& CloseState() {
  static base::NoDestructor<CloseRecordState> state;
  return *state;
}

bool TakeExitRequest() {
  CloseRecordState& state = CloseState();
  const bool requested = !state.exit_requested_at.is_null() &&
                         base::TimeTicks::Now() - state.exit_requested_at < kExitRequestWindow;
  state.exit_requested_at = base::TimeTicks();
  return requested;
}

std::string RecentActivations(base::TimeTicks now) {
  const CloseRecordState& state = CloseState();
  std::string out;
  for (auto it = state.activations.rbegin(); it != state.activations.rend(); ++it) {
    if (!out.empty()) {
      out += ", ";
    }
    out += base::StringPrintf("%s window=%ld ageMs=%ld", it->change.c_str(), it->window,
                              static_cast<long>((now - it->at).InMilliseconds()));
  }
  return out.empty() ? "none" : out;
}

void RecordClose(content::WebContents* opener, NSString* kind, bool entered_auto, bool by_app) {
  CloseRecordState& state = CloseState();
  AutoPictureInPictureTabHelper* helper =
      opener ? AutoPictureInPictureTabHelper::FromWebContents(opener) : nullptr;
  const int chrome_auto = helper ? (helper->IsInAutoPictureInPicture() ? 1 : 0) : -1;
  const std::optional<bool> shown = ShownByHost(opener);
  state.closes++;
  state.records.push_back(base::StringPrintf(
      "#%d by=%s kind=%s opener=%d enteredAuto=%d chromeAuto=%d hostShown=%d activations=[%s]",
      state.closes, by_app ? "app" : "chrome", kind.UTF8String, opener != nullptr, entered_auto,
      chrome_auto, shown ? (*shown ? 1 : 0) : -1,
      RecentActivations(base::TimeTicks::Now()).c_str()));
  while (state.records.size() > kCloseRecordLimit) {
    state.records.pop_front();
  }
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
    auto* helper = AutoPictureInPictureTabHelper::FromWebContents(opener);
    entered_auto_ = helper && helper->IsInAutoPictureInPicture();
    if (PictureInPictureTracing()) {
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
    const bool by_app = TakeExitRequest();
    RecordClose(opener_.get(), kind_, entered_auto_, by_app);
    if (!opener_) {
      return;
    }
    Report(opener_, false, kind_, by_app ? @"app" : @"chrome", entered_auto_);
    opener_ = nullptr;
  }

 private:
  base::WeakPtr<content::WebContents> opener_;
  NSString* __strong kind_ = @"video";
  bool entered_auto_ = false;
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

void NoteWindowActivation(const char* change, long window_number) {
  CloseRecordState& state = CloseState();
  state.activations.push_back({change, window_number, base::TimeTicks::Now()});
  while (state.activations.size() > kActivationNoteLimit) {
    state.activations.pop_front();
  }
}

void NotePictureInPictureExitRequested() {
  CloseState().exit_requested_at = base::TimeTicks::Now();
}

std::string PictureInPictureCloseRecord() {
  const CloseRecordState& state = CloseState();
  if (state.records.empty()) {
    return "none";
  }
  std::string out;
  for (const std::string& record : state.records) {
    if (!out.empty()) {
      out += " | ";
    }
    out += record;
  }
  return out;
}

void StartPictureInPictureObserver() {
  static base::NoDestructor<PictureInPictureObserver> observer;
  PictureInPictureWindowManager::GetInstance()->AddObserver(observer.get());
  if (Background()) {
    static base::NoDestructor<DocumentPipBrowsers> documents;
  }
}

}
