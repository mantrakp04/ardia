#import "ArdiaWebViewInternal.h"

static const NSTimeInterval kRecordingPictureTimeout = 0.5;

@implementation ArdiaWebView (Recording)

- (void)copyRecordingPicture:(void (^)(CGImageRef _Nullable picture))completion {
  if (!_tab || !self.window || self.isHiddenOrHasHiddenAncestor) return completion(NULL);
  [_tab copyPicture:kRecordingPictureTimeout completion:completion];
}

@end
