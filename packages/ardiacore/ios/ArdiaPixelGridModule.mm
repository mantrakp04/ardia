#import <AppKit/AppKit.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <React/RCTRootView.h>
#import <React/RCTShadowView.h>
#import <React/RCTUIManager.h>
#import <React/RCTUIManagerUtils.h>
#import <yoga/Yoga.h>

#import "ArdiaChromeWindowHost.h"

namespace {

BOOL HostsReact(NSWindow *window) {
  return [ArdiaWindowRootView(window) isKindOfClass:RCTRootView.class];
}

CGFloat CoarsestReactWindowScale() {
  CGFloat coarsest = 0;
  for (NSWindow *window in NSApp.windows) {
    const CGFloat scale = window.backingScaleFactor;
    if (!window.visible || scale <= 0 || (coarsest > 0 && scale >= coarsest) || !HostsReact(window)) continue;
    coarsest = scale;
  }
  return coarsest;
}

NSArray<NSNotificationName> *GridChangingNotifications() {
  return @[
    NSWindowDidChangeBackingPropertiesNotification, NSWindowDidChangeScreenNotification, NSWindowDidChangeOcclusionStateNotification,
    NSWindowWillCloseNotification, NSApplicationDidChangeScreenParametersNotification
  ];
}

}

@interface ArdiaPixelGridModule : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation ArdiaPixelGridModule {
  NSMutableArray<id> *_observers;
  CGFloat _applied;
  BOOL _pending;
}

@synthesize bridge = _bridge;

RCT_EXPORT_MODULE(ACPixelGrid)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  if ((self = [super init])) {
    _observers = [NSMutableArray array];
    __weak ArdiaPixelGridModule *weakSelf = self;
    for (NSNotificationName name in GridChangingNotifications()) {
      [_observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:name
                                                                           object:nil
                                                                            queue:NSOperationQueue.mainQueue
                                                                       usingBlock:^(NSNotification *) {
                                                                         [weakSelf followWindowsSoon];
                                                                       }]];
    }
    [self followWindowsSoon];
  }
  return self;
}

- (void)invalidate {
  NSArray<id> *observers = _observers;
  _observers = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    for (id observer in observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  });
}

- (void)followWindowsSoon {
  if (_pending || !_observers) return;
  _pending = YES;
  __weak ArdiaPixelGridModule *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    ArdiaPixelGridModule *me = weakSelf;
    if (!me) return;
    me->_pending = NO;
    [me followWindows];
  });
}

- (void)followWindows {
  const CGFloat scale = CoarsestReactWindowScale();
  RCTUIManager *uiManager = _bridge.uiManager;
  if (scale <= 0 || scale == _applied || !uiManager || !_observers) return;
  _applied = scale;
  RCTExecuteOnUIManagerQueue(^{
    YGConfigRef config = [RCTShadowView yogaConfig];
    if (YGConfigGetPointScaleFactor(config) == (float)scale) return;
    YGConfigSetPointScaleFactor(config, (float)scale);
    [uiManager setNeedsLayout];
  });
}

@end
