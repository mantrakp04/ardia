#import "ArdiaWebViewInternal.h"

static const NSTimeInterval kCapturePictureTimeout = 1.0;
static const NSTimeInterval kFullPageMetricsTimeout = 2.0;
static const NSTimeInterval kFullPagePictureTimeout = 20.0;
static const double kFullPageMostPixels = 16384;

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

- (NSView *)pageViewForCapture {
  NSView *page = _tab.view;
  return page.superview == self ? page : nil;
}

- (void)copyFullPagePicture:(void (^)(NSData *))completion {
  ArdiaCoreTab *tab = _tab;
  if (!tab) return completion(nil);
  const double backing = self.window.backingScaleFactor ?: 2;
  [tab devToolsCall:@"Page.getLayoutMetrics"
             params:@{}
            timeout:kFullPageMetricsTimeout
         completion:^(NSDictionary *metrics, NSString *error) {
           NSDictionary *css = metrics[@"cssContentSize"];
           NSDictionary *device = metrics[@"contentSize"];
           const double width = [css[@"width"] doubleValue], height = [css[@"height"] doubleValue];
           if (!(width > 0 && height > 0)) return completion(nil);
           const double devicePixels = [device[@"width"] doubleValue];
           const double pixelsPerCSS = devicePixels > 0 ? devicePixels / width : backing;
           const double scale = MAX(1 / pixelsPerCSS, MIN(1, kFullPageMostPixels / (height * pixelsPerCSS)));
           const double shown = MIN(height, floor(kFullPageMostPixels / (pixelsPerCSS * scale)));
           NSDictionary *params = @{
             @"format" : @"png",
             @"captureBeyondViewport" : @YES,
             @"fromSurface" : @YES,
             @"clip" : @{@"x" : @0, @"y" : @0, @"width" : @(width), @"height" : @(shown), @"scale" : @(scale)},
           };
           [tab devToolsCall:@"Page.captureScreenshot"
                      params:params
                     timeout:kFullPagePictureTimeout
                  completion:^(NSDictionary *shot, NSString *failure) {
                    NSString *data = shot[@"data"];
                    completion([data isKindOfClass:NSString.class] ? [[NSData alloc] initWithBase64EncodedString:data options:0] : nil);
                  }];
         }];
}

@end
