#import "ArdiaWebViewInternal.h"

static const NSTimeInterval kCapturePictureTimeout = 1.0;

@implementation ArdiaWebView (Capture)

- (void)copyPictureForCapture:(void (^)(CGImageRef, NSRect))completion {
  NSView *page = _tab.view;
  if (!_tab || !self.window || self.isHiddenOrHasHiddenAncestor || !page || page.superview != self || page.hidden) {
    return completion(NULL, NSZeroRect);
  }
  const NSRect frame = page.frame;
  [_tab copyPicture:kCapturePictureTimeout
         completion:^(CGImageRef picture) {
           completion(picture, frame);
         }];
}

@end
