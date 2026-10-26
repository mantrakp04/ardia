#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "content/public/browser/web_contents.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

namespace {

class MediaCaptureObserver : public MediaStreamCaptureIndicator::Observer {
 public:
  explicit MediaCaptureObserver(scoped_refptr<MediaStreamCaptureIndicator> indicator)
      : indicator_(std::move(indicator)) {
    indicator_->AddObserver(this);
  }
  void OnIsCapturingVideoChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingAudioChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingTabChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingWindowChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }
  void OnIsCapturingDisplayChanged(content::WebContents* contents, bool) override {
    Changed(contents);
  }

  NSDictionary* AccessOf(content::WebContents* contents) const {
    return @{
      @"camera" : @(indicator_->IsCapturingVideo(contents)),
      @"microphone" : @(indicator_->IsCapturingAudio(contents)),
      @"screen" : @(indicator_->IsCapturingTab(contents) ||
                    indicator_->IsCapturingWindow(contents) ||
                    indicator_->IsCapturingDisplay(contents)),
    };
  }

 private:
  void Changed(content::WebContents* contents) {
    if (contents) {
      TabBridge::GetOrCreate(contents)->MediaAccessChanged();
    }
  }

  scoped_refptr<MediaStreamCaptureIndicator> indicator_;
};

MediaCaptureObserver*& CaptureObserver() {
  static MediaCaptureObserver* observer = nullptr;
  return observer;
}

}

void StartMediaCaptureObserver() {
  if (!CaptureObserver()) {
    CaptureObserver() = new MediaCaptureObserver(
        MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator());
  }
}

void TabBridge::MediaAccessChanged() {
  if (!CaptureObserver()) {
    return;
  }
  NSDictionary* access = CaptureObserver()->AccessOf(web_contents());
  if ([access isEqualToDictionary:media_access_]) {
    return;
  }
  media_access_ = access;
  ArdiaCoreTab* tab = tab_;
  id<ArdiaCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didChangeMediaAccess:)]) {
    [delegate tab:tab didChangeMediaAccess:access];
  }
}

}
