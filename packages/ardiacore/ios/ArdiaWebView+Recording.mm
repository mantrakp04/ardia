#import "ArdiaWebViewInternal.h"
#import "ArdiaPictureInPictureInternal.h"

static const NSTimeInterval kRecordingPictureTimeout = 0.5;

@implementation ArdiaWebView (Recording)

- (void)copyRecordingPicture:(void (^)(CGImageRef _Nullable picture))completion {
  if (!_tab || !self.window || self.isHiddenOrHasHiddenAncestor) return completion(NULL);
  [_tab copyPicture:kRecordingPictureTimeout completion:completion];
}

+ (NSString *)recordingKindOfWindow:(NSWindow *)window {
  if ([ArdiaPiPController forWindow:window] || ardia_pip::IsChromeVideoPictureInPicture(window)) return @"pictureInPicture";
  if (ardia_pip::IsChromeDocumentPictureInPicture(window)) return @"documentPictureInPicture";
  if ([ArdiaCoreWindow isChromeFramelessWindow:window]) return @"chrome";
  return @"app";
}

+ (CGFloat)recordingCornerRadiusOfWindow:(NSWindow *)window {
  ArdiaPiPController *controller = [ArdiaPiPController forWindow:window];
  return controller ? controller.cornerRadius : window.contentView.layer.cornerRadius;
}

+ (void)copyRecordingPictureOfWindow:(NSWindow *)window completion:(void (^)(CGImageRef _Nullable picture))completion {
  [ArdiaCoreWindow copyPictureOfChromeWindow:window completion:completion];
}

+ (NSView *)recordingControlsOfWindow:(NSWindow *)window {
  return [ArdiaPiPController forWindow:window].overlay;
}

@end
