#import "ArdiaWebView+VaultCodeSetup.h"
#import "ArdiaWebView+VaultContextMenu.h"
#import "ArdiaWebViewInternal.h"

#import <objc/runtime.h>

#include <algorithm>
#include <cmath>

using namespace ardia_web_view;

typedef NS_ENUM(NSInteger, ArdiaVaultCodeState) {
  ArdiaVaultCodeReading,
  ArdiaVaultCodeFound,
  ArdiaVaultCodeMissed,
};

namespace {

constexpr CFTimeInterval kCodeTargetFreshSeconds = 2;
constexpr NSUInteger kMaxCodeLogins = 12;
constexpr NSTimeInterval kCodePictureTimeout = 1.0;
constexpr double kCropMargin = 0.15;
constexpr double kSmallestTarget = 12;
constexpr NSUInteger kLongestCodeText = 2048;
constexpr NSUInteger kLongestLabel = 120;

NSString *const kCodeTitle = @"Set Up Verification Code";
NSString *const kReadingTitle = @"Reading Code…";
NSString *const kLoadingTitle = @"Loading…";
NSString *const kOtherLoginsTitle = @"Other Logins…";
NSString *const kUnlockTitle = @"Unlock Passwords…";
NSString *const kPathSeparator = @" › ";

BOOL gCodeSetup = NO;
ArdiaVaultCodeReader gCodeReader = nil;
char kVaultCodeKey;
char kShownVaultItemsKey;

bool CodeSecureOrigin(NSString *origin) {
  if ([origin hasPrefix:@"https://"]) return true;
  for (NSString *local in @[ @"http://localhost", @"http://127.0.0.1", @"http://[::1]" ])
    if ([origin isEqualToString:local] || [origin hasPrefix:[local stringByAppendingString:@":"]]) return true;
  return false;
}

NSDictionary *CodeLogin(id value) {
  NSDictionary *login = [value isKindOfClass:NSDictionary.class] ? value : nil;
  NSString *key = Text(login, @"key", 512);
  NSString *title = Text(login, @"title", 200);
  if (!key.length || !title.length) return nil;
  return @{@"key" : key, @"title" : title};
}

NSDictionary *CodeMenuModel(NSDictionary *menu) {
  NSMutableArray *logins = [NSMutableArray array];
  for (id value in Field<NSArray>(menu, @"logins") ?: @[]) {
    if (logins.count >= kMaxCodeLogins) break;
    if (NSDictionary *login = CodeLogin(value)) [logins addObject:login];
  }
  NSString *note = Text(menu, @"note", 200);
  return @{@"logins" : logins, @"unlock" : @(Flag(menu, @"unlock")), @"other" : @(Flag(menu, @"other")), @"note" : note.length ? note : NSNull.null};
}

NSArray<NSString *> *CodePickPath(NSString *pick) {
  NSMutableArray<NSString *> *path = [NSMutableArray array];
  for (NSString *part in [pick componentsSeparatedByString:kPathSeparator]) {
    NSString *trimmed = [part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (trimmed.length) [path addObject:trimmed];
  }
  return path;
}

NSMenuItem *ItemTitled(NSArray<NSMenuItem *> *items, NSString *title) {
  for (NSMenuItem *item in items)
    if (!item.isSeparatorItem && [item.title isEqualToString:title]) return item;
  return nil;
}

NSString *HeaderOf(NSString *issuer, NSString *account) {
  if (!issuer.length) return account;
  if (!account.length || [issuer caseInsensitiveCompare:account] == NSOrderedSame) return issuer;
  return [NSString stringWithFormat:@"%@: %@", issuer, account];
}

NSDictionary *CodeTargetRect(NSDictionary *rect) {
  double x, y, width, height;
  if (!Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &width) || !Finite(rect, @"height", &height)) return nil;
  return @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)};
}

CGImageRef CopyCodeCrop(CGImageRef picture, NSDictionary *dict, BOOL main) {
  const double width = CGImageGetWidth(picture), height = CGImageGetHeight(picture);
  if (width < kSmallestTarget || height < kSmallestTarget) return NULL;
  if (!main) return CGImageRetain(picture);
  NSDictionary *rect = Field<NSDictionary>(dict, @"rect");
  NSDictionary *viewport = Field<NSDictionary>(dict, @"viewport");
  double x, y, w, h, viewWidth, viewHeight;
  if (!Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &w) || !Finite(rect, @"height", &h)) return NULL;
  if (!Finite(viewport, @"width", &viewWidth) || !Finite(viewport, @"height", &viewHeight)) return NULL;
  if (viewWidth <= 0 || viewHeight <= 0 || w < kSmallestTarget || h < kSmallestTarget) return NULL;
  const double scaleX = width / viewWidth, scaleY = height / viewHeight;
  const double margin = kCropMargin * std::max(w * scaleX, h * scaleY);
  CGRect crop = CGRectMake(x * scaleX - margin, y * scaleY - margin, w * scaleX + 2 * margin, h * scaleY + 2 * margin);
  crop = CGRectIntersection(CGRectIntegral(crop), CGRectMake(0, 0, width, height));
  if (CGRectIsNull(crop) || CGRectGetWidth(crop) < kSmallestTarget || CGRectGetHeight(crop) < kSmallestTarget) return NULL;
  return CGImageCreateWithImageInRect(picture, crop);
}

}

@interface ArdiaVaultCodeContext : NSObject
@property(nonatomic, copy) NSString *frameId;
@property(nonatomic, copy) NSString *origin;
@property(nonatomic) CFTimeInterval at;
@property(nonatomic) BOOL shown;
@property(nonatomic) BOOL main;
@property(nonatomic, strong) id rect;
@property(nonatomic) ArdiaVaultCodeState state;
@property(nonatomic, copy) NSString *token;
@property(nonatomic, copy) NSString *header;
@property(nonatomic, copy) NSDictionary *model;
@property(nonatomic, weak) ArdiaWebView *view;
@property(nonatomic, strong) NSHashTable<NSMenu *> *menus;
@property(nonatomic, strong) NSHashTable<NSMenuItem *> *topItems;
@property(nonatomic, copy) NSArray<NSString *> *pendingPick;
@property(nonatomic, copy) void (^redump)(NSArray<NSDictionary *> *described);
@end

@implementation ArdiaVaultCodeContext

- (instancetype)init {
  if ((self = [super init])) {
    _menus = [NSHashTable weakObjectsHashTable];
    _topItems = [NSHashTable weakObjectsHashTable];
    _header = @"";
    _state = ArdiaVaultCodeReading;
  }
  return self;
}

- (NSMenuItem *)choice:(NSString *)title action:(NSDictionary *)action {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:@selector(choose:) keyEquivalent:@""];
  item.target = self;
  item.representedObject = action;
  return item;
}

- (NSMenuItem *)note:(NSString *)title {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  item.enabled = NO;
  return item;
}

- (void)fillMenu:(NSMenu *)menu {
  [menu removeAllItems];
  if (self.state != ArdiaVaultCodeFound) {
    [menu addItem:[self note:kReadingTitle]];
    return;
  }
  if (self.header.length) {
    [menu addItem:[self note:self.header]];
    [menu addItem:NSMenuItem.separatorItem];
  }
  NSDictionary *model = self.model;
  if (!model) {
    [menu addItem:[self note:kLoadingTitle]];
    return;
  }
  NSUInteger listed = 0;
  for (NSDictionary *login in model[@"logins"]) {
    [menu addItem:[self choice:login[@"title"] action:@{@"action" : @"save", @"login" : login[@"key"]}]];
    listed++;
  }
  if ([model[@"note"] isKindOfClass:NSString.class]) {
    [menu addItem:[self note:model[@"note"]]];
    listed++;
  }
  const BOOL unlock = Flag(model, @"unlock"), other = Flag(model, @"other");
  if ((unlock || other) && listed) [menu addItem:NSMenuItem.separatorItem];
  if (unlock) [menu addItem:[self choice:kUnlockTitle action:@{@"action" : @"unlock"}]];
  if (other) [menu addItem:[self choice:kOtherLoginsTitle action:@{@"action" : @"other"}]];
}

- (NSArray<NSMenuItem *> *)makeTopItems {
  if (self.state == ArdiaVaultCodeMissed) return @[];
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:kCodeTitle action:nil keyEquivalent:@""];
  NSMenu *menu = [[NSMenu alloc] initWithTitle:kCodeTitle];
  menu.autoenablesItems = NO;
  [self fillMenu:menu];
  [self.menus addObject:menu];
  [self.topItems addObject:item];
  item.submenu = menu;
  return @[ item ];
}

- (void)choose:(NSMenuItem *)sender {
  NSDictionary *action = [sender.representedObject isKindOfClass:NSDictionary.class] ? sender.representedObject : nil;
  ArdiaWebView *view = self.view;
  NSString *token = self.token;
  if (!action || !view || !token.length) return;
  NSMutableDictionary *payload = [action mutableCopy];
  payload[@"frameId"] = self.frameId;
  payload[@"origin"] = self.origin;
  payload[@"token"] = token;
  dispatch_async(dispatch_get_main_queue(), ^{
    [view emit:@"vaultCodeAction" payload:payload];
  });
}

- (void)refresh {
  for (NSMenu *menu in self.menus.allObjects) [self fillMenu:menu];
  for (NSMenuItem *item in self.topItems.allObjects) item.hidden = self.state == ArdiaVaultCodeMissed;
  ArdiaWebView *view = self.view;
  if (self.redump && view) self.redump([view describeVaultContextItems:view.shownVaultContextItems]);
}

- (void)settle:(NSDictionary<NSString *, NSString *> *)code {
  NSString *token = Text(code, @"token", 64);
  ArdiaWebView *view = self.view;
  if (!token.length || !view) {
    self.state = ArdiaVaultCodeMissed;
    self.pendingPick = nil;
    [self refresh];
    return;
  }
  NSString *issuer = Text(code, @"issuer", kLongestLabel) ?: @"";
  NSString *account = Text(code, @"account", kLongestLabel) ?: @"";
  self.state = ArdiaVaultCodeFound;
  self.token = token;
  self.header = HeaderOf(issuer, account);
  [self refresh];
  [view emit:@"vaultCode"
      payload:@{
        @"frameId" : self.frameId,
        @"origin" : self.origin,
        @"main" : @(self.main),
        @"rect" : self.rect ?: NSNull.null,
        @"token" : token,
        @"issuer" : issuer,
        @"account" : account,
      }];
}

- (void)adoptModel:(NSDictionary *)model {
  self.model = model;
  [self refresh];
  NSArray<NSString *> *pending = self.pendingPick;
  self.pendingPick = nil;
  if (pending) [self pick:pending];
}

- (BOOL)pick:(NSArray<NSString *> *)path {
  NSMenuItem *top = self.topItems.allObjects.firstObject;
  if (path.count < 2 || !top || top.hidden) return NO;
  NSMenuItem *item = ItemTitled(top.submenu.itemArray, path[1]);
  if (!item.action || !item.enabled) return NO;
  [self choose:item];
  return YES;
}

@end

namespace {

ArdiaVaultCodeContext *CodeContextOf(ArdiaWebView *view) { return objc_getAssociatedObject(view, &kVaultCodeKey); }

}

@implementation ArdiaWebView (VaultCodeSetup)

+ (void)setVaultCodeSetup:(BOOL)enabled {
  gCodeSetup = enabled;
  if (enabled) [ArdiaWebView ensureVaultContextMenuHook];
}

+ (void)setVaultCodeReader:(ArdiaVaultCodeReader)reader {
  gCodeReader = [reader copy];
}

- (void)applyVaultCodeMenu:(NSDictionary<NSString *, id> *)menu token:(NSString *)token {
  ArdiaVaultCodeContext *context = CodeContextOf(self);
  if (!context.token.length || ![context.token isEqualToString:token ?: @""]) return;
  [context adoptModel:CodeMenuModel(menu)];
}

@end

@implementation ArdiaWebView (VaultCodeSetupInternal)

- (void)noteVaultCodeTarget:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main origin:(NSString *)origin {
  objc_setAssociatedObject(self, &kVaultCodeKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  ArdiaVaultCodeReader reader = gCodeReader;
  if (!gCodeSetup || !reader || !frameId.length || !CodeSecureOrigin(origin ?: @"")) return;
  const BOOL image = Flag(dict, @"image");
  NSString *text = image ? nil : Field<NSString>(dict, @"text");
  if (!image && (!text.length || text.length > kLongestCodeText)) return;
  ArdiaCoreTab *tab = _tab;
  if (image && !tab) return;
  ArdiaVaultCodeContext *context = [ArdiaVaultCodeContext new];
  context.frameId = frameId;
  context.origin = origin;
  context.at = CACurrentMediaTime();
  context.view = self;
  context.main = main;
  context.rect = main ? CodeTargetRect(Field<NSDictionary>(dict, @"rect")) : nil;
  objc_setAssociatedObject(self, &kVaultCodeKey, context, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  __weak ArdiaVaultCodeContext *weakContext = context;
  ArdiaVaultCodeAnswer answer = ^(NSDictionary<NSString *, NSString *> *code) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakContext settle:code];
    });
  };
  if (!image) return reader(nil, text, origin, answer);
  NSDictionary *target = [dict copy];
  [tab copyPicture:kCodePictureTimeout
        completion:^(CGImageRef picture) {
          CGImageRef crop = picture ? CopyCodeCrop(picture, target, main) : NULL;
          if (!crop) return answer(nil);
          reader(crop, nil, origin, answer);
          CGImageRelease(crop);
        }];
}

- (NSArray<NSMenuItem *> *)takeVaultCodeMenuItems {
  ArdiaVaultCodeContext *context = CodeContextOf(self);
  if (!context || context.shown || CACurrentMediaTime() - context.at > kCodeTargetFreshSeconds) return @[];
  context.shown = YES;
  return [context makeTopItems];
}

- (BOOL)pickVaultCodeMenu:(NSString *)pick redump:(void (^)(NSArray<NSDictionary *> *described))redump {
  NSArray<NSString *> *path = CodePickPath(pick ?: @"");
  if (!path.count || ![path.firstObject isEqualToString:kCodeTitle]) return NO;
  ArdiaVaultCodeContext *context = CodeContextOf(self);
  if (!context || !context.topItems.allObjects.count) return NO;
  context.redump = redump;
  if ([context pick:path]) return YES;
  if (path.count < 2 || context.state == ArdiaVaultCodeMissed || (context.state == ArdiaVaultCodeFound && context.model)) return NO;
  context.pendingPick = path;
  return YES;
}

- (void)noteShownVaultContextItems:(NSArray<NSMenuItem *> *)items {
  objc_setAssociatedObject(self, &kShownVaultItemsKey, [items copy], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (NSArray<NSMenuItem *> *)shownVaultContextItems {
  NSArray<NSMenuItem *> *items = objc_getAssociatedObject(self, &kShownVaultItemsKey) ?: @[];
  return [items filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSMenuItem *item, NSDictionary *bindings) {
                  return !item.hidden;
                }]];
}

@end
