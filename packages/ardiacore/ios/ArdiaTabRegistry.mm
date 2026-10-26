#import "ArdiaInternal.h"
#import "ArdiaWebView.h"

#import <objc/runtime.h>

namespace {

NSMapTable<ArdiaCoreTab *, ArdiaWebView *> *Views() {
  static NSMapTable *views = [NSMapTable weakToWeakObjectsMapTable];
  return views;
}

NSMutableDictionary<NSString *, ArdiaCoreTab *> *Offered() {
  static NSMutableDictionary *offered = [NSMutableDictionary dictionary];
  return offered;
}

constexpr int64_t kOfferSeconds = 30;

}

@implementation ArdiaTabRegistry

+ (void)setView:(ArdiaWebView *)view forTab:(ArdiaCoreTab *)tab {
  if (view) [Views() setObject:view forKey:tab];
  else [Views() removeObjectForKey:tab];
}

+ (ArdiaWebView *)viewForTab:(ArdiaCoreTab *)tab {
  return [Views() objectForKey:tab];
}

+ (NSString *)offerTab:(ArdiaCoreTab *)tab {
  return [self offerTab:tab prefix:@"ardiacore"];
}

+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix {
  NSString *adoptId = [NSString stringWithFormat:@"%@:%d", prefix, ardia_host::BrowserId(tab)];
  Offered()[adoptId] = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kOfferSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (Offered()[adoptId] != tab) return;
    [Offered() removeObjectForKey:adoptId];
    if (![ArdiaTabRegistry viewForTab:tab]) [tab close];
  });
  return adoptId;
}

+ (ArdiaCoreTab *)offeredTab:(NSString *)adoptId {
  return adoptId.length ? Offered()[adoptId] : nil;
}

+ (ArdiaCoreTab *)takeOffered:(NSString *)adoptId {
  ArdiaCoreTab *tab = Offered()[adoptId];
  if (tab) [Offered() removeObjectForKey:adoptId];
  return tab;
}

+ (void)forget:(ArdiaCoreTab *)tab {
  [Views() removeObjectForKey:tab];
  for (NSString *key in [Offered() allKeysForObject:tab]) [Offered() removeObjectForKey:key];
}

@end

namespace ardia_host {

namespace {
const void *kBrowserIdKey = &kBrowserIdKey;
NSMapTable<NSNumber *, ArdiaCoreTab *> *TabsById() {
  static NSMapTable *tabs = [NSMapTable strongToWeakObjectsMapTable];
  return tabs;
}
}

int BrowserId(ArdiaCoreTab *tab) {
  static int next = 0;
  NSNumber *id_ = objc_getAssociatedObject(tab, kBrowserIdKey);
  if (!id_) {
    id_ = @(++next);
    objc_setAssociatedObject(tab, kBrowserIdKey, id_, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [TabsById() setObject:tab forKey:id_];
  }
  return id_.intValue;
}

ArdiaCoreTab *TabWithBrowserId(int browserId) {
  return [TabsById() objectForKey:@(browserId)];
}

NSString *AppTabIdOf(ArdiaCoreTab *tab) {
  NSString *tabId = tab ? [ArdiaTabRegistry viewForTab:tab].transferKey : nil;
  return tabId.length ? tabId : nil;
}

id AppTabIdValue(ArdiaCoreTab *tab) {
  return AppTabIdOf(tab) ?: NSNull.null;
}

ArdiaCoreTab *TabWithAppTabId(NSString *tabId) {
  if (!tabId.length) return nil;
  for (ArdiaCoreTab *tab in Views().keyEnumerator.allObjects)
    if ([[Views() objectForKey:tab].transferKey isEqualToString:tabId]) return tab;
  return nil;
}

namespace {
NSMapTable<ArdiaCoreTab *, NSMutableArray<NSArray *> *> *HeldEvents() {
  static NSMapTable *held = [NSMapTable weakToStrongObjectsMapTable];
  return held;
}
}

void HoldUntilHosted(ArdiaCoreTab *tab, NSString *event, NSDictionary *payload) {
  NSMutableArray *list = [HeldEvents() objectForKey:tab];
  if (!list) [HeldEvents() setObject:(list = [NSMutableArray array]) forKey:tab];
  [list addObject:@[ event, payload ]];
}

void DropHeldEvent(NSString *event, NSString *eventId) {
  for (ArdiaCoreTab *tab in HeldEvents().keyEnumerator.allObjects) {
    NSMutableArray<NSArray *> *list = [HeldEvents() objectForKey:tab];
    NSIndexSet *dropped = [list indexesOfObjectsPassingTest:^BOOL(NSArray *held, NSUInteger, BOOL *) {
      return [held[0] isEqualToString:event] && [held[1][@"id"] isEqual:eventId];
    }];
    [list removeObjectsAtIndexes:dropped];
    if (!list.count) [HeldEvents() removeObjectForKey:tab];
  }
}

void ReleaseHeldEvents(ArdiaCoreTab *tab) {
  NSString *tabId = AppTabIdOf(tab);
  NSArray<NSArray *> *held = tabId ? [HeldEvents() objectForKey:tab] : nil;
  if (!held) return;
  [HeldEvents() removeObjectForKey:tab];
  for (NSArray *event in held) {
    NSMutableDictionary *payload = [event[1] mutableCopy];
    payload[@"tabId"] = tabId;
    [ArdiaEvents emit:event[0] data:payload];
  }
}

}
