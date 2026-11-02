#import "ArdiaChromeWindowInternal.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_window;

namespace ardia_window {

BOOL gPageCoverOff = NO;
}

static const NSTimeInterval kPageCoverPicture = 0.25;
static const NSTimeInterval kPageCoverLimit = 4;

@implementation ArdiaPageCover {
  CGImageRef _picture;
  NSSize _pictured;
}

+ (void)coverTabs:(NSArray<ArdiaCoreTab *> *)tabs then:(void (^)(NSArray<ArdiaPageCover *> *covers))then {
  NSMutableArray<ArdiaPageCover *> *covers = [NSMutableArray array];
  __block NSUInteger waiting = tabs.count + 1;
  void (^one)(ArdiaPageCover *) = ^(ArdiaPageCover *cover) {
    if (cover) [covers addObject:cover];
    if (--waiting == 0) then(covers);
  };
  for (ArdiaCoreTab *tab in tabs) [self coverTab:tab then:one];
  one(nil);
}

+ (void)coverTab:(ArdiaCoreTab *)tab then:(void (^)(ArdiaPageCover *cover))then {
  NSView *page = tab.view;
  if (gPageCoverOff || !page.window || page.isHiddenOrHasHiddenAncestor) return then(nil);
  __weak ArdiaCoreTab *weakTab = tab;
  __weak NSWindow *weakWindow = page.window;
  __weak NSView *weakHost = page.superview;
  const NSSize pictured = page.bounds.size;
  [tab copyPicture:kPageCoverPicture
        completion:^(CGImageRef picture) {
          ArdiaCoreTab *t = weakTab;
          NSView *now = t.view;
          if (!picture || !now.window || now.window != weakWindow || now.superview != weakHost) return then(nil);
          ArdiaPageCover *cover = [[ArdiaPageCover alloc] initWithFrame:now.bounds picture:picture];
          cover->_tab = t;
          cover->_pictured = pictured;
          [now addSubview:cover];
          [cover displayIfNeeded];
          cover.layer.contents = (__bridge id)cover->_picture;
          then(cover);
        }];
}

- (instancetype)initWithFrame:(NSRect)frame picture:(CGImageRef)picture {
  if ((self = [super initWithFrame:frame])) {
    _picture = CGImageRetain(picture);
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    __weak ArdiaPageCover *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageCoverLimit * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [weakSelf uncover:NO];
    });
  }
  return self;
}

- (void)dealloc {
  CGImageRelease(_picture);
}

- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.contents = (__bridge id)_picture;
  self.layer.contentsGravity = kCAGravityResize;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (BOOL)isAccessibilityElement {
  return NO;
}

- (void)repicture {
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!self.superview || !page) return;
  __weak ArdiaPageCover *weakSelf = self;
  const NSSize before = _pictured;
  [ArdiaPageDrawWait tab:tab
                draws:^NSInteger(BOOL, BOOL) { return NSEqualSizes(page.bounds.size, before) ? 0 : 1; }
                 then:^{
                   ArdiaPageCover *me = weakSelf;
                   ArdiaCoreTab *t = me.tab;
                   const NSSize now = t.view.bounds.size;
                   if (!me.superview || !t || NSEqualSizes(now, before)) return;
                   [t copyPicture:kPageCoverPicture
                       completion:^(CGImageRef picture) {
                         ArdiaPageCover *again = weakSelf;
                         if (!picture || !again.superview) return;
                         CGImageRelease(again->_picture);
                         again->_picture = CGImageRetain(picture);
                         again->_pictured = now;
                         again.layer.contents = (__bridge id)again->_picture;
                       }];
                 }];
}

- (void)uncover:(BOOL)fade {
  if (!self.superview) return;
  if (!fade) return [self removeFromSuperview];
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.1;
        self.animator.alphaValue = 0;
      }
      completionHandler:^{
        [self removeFromSuperview];
      }];
}

@end
