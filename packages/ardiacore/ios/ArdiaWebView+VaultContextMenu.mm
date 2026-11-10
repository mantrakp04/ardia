#import "ArdiaWebView+VaultContextMenu.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

#import <objc/runtime.h>

#include <cmath>

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kContextFieldFreshSeconds = 2;
constexpr NSUInteger kMaxContextLogins = 12;
constexpr NSUInteger kMaxGenerators = 8;
constexpr double kMaxContextLength = 4096;

NSString *const kAutofillTitle = @"Autofill";
NSString *const kGenerateTitle = @"Generate Password";
NSString *const kUnlockTitle = @"Unlock Passwords…";
NSString *const kOtherTitle = @"Other Passwords…";
NSString *const kLoadingTitle = @"Loading…";
NSString *const kPathSeparator = @" › ";

BOOL gContextAutofill = NO;
NSArray<NSDictionary<NSString *, NSString *> *> *gContextGenerators = nil;
char kVaultContextKey;
char kVaultContextFillKey;

NSArray<NSString *> *ContextChoices() { return @[ @"username", @"password", @"otp" ]; }

NSDictionary<NSString *, NSString *> *ContextChoiceTitles() {
  return @{@"username" : @"Username", @"password" : @"Password", @"otp" : @"Verification Code"};
}

NSArray<NSString *> *ContextFieldKinds() { return @[ @"username", @"password", @"newPassword", @"otp" ]; }

NSArray<NSString *> *GeneratorStyles() { return @[ @"strong", @"alphanumeric", @"easyToType", @"passphrase" ]; }

bool ContextSecureOrigin(NSString *origin) {
  if ([origin hasPrefix:@"https://"]) return true;
  for (NSString *local in @[ @"http://localhost", @"http://127.0.0.1", @"http://[::1]" ])
    if ([origin isEqualToString:local] || [origin hasPrefix:[local stringByAppendingString:@":"]]) return true;
  return false;
}

NSDictionary *ContextLogin(id value) {
  NSDictionary *login = [value isKindOfClass:NSDictionary.class] ? value : nil;
  NSString *key = Text(login, @"key", 512);
  NSString *title = Text(login, @"title", 200);
  if (!key.length || !title.length) return nil;
  NSMutableArray<NSString *> *fields = [NSMutableArray array];
  for (id field in Field<NSArray>(login, @"fields") ?: @[])
    if ([field isKindOfClass:NSString.class] && [ContextChoices() containsObject:field] && ![fields containsObject:field]) [fields addObject:field];
  return fields.count ? @{@"key" : key, @"title" : title, @"fields" : fields} : nil;
}

NSDictionary *ContextMenuModel(NSDictionary *menu) {
  NSMutableArray *logins = [NSMutableArray array];
  for (id value in Field<NSArray>(menu, @"logins") ?: @[]) {
    if (logins.count >= kMaxContextLogins) break;
    if (NSDictionary *login = ContextLogin(value)) [logins addObject:login];
  }
  NSString *note = Text(menu, @"note", 200);
  return @{@"logins" : logins, @"unlock" : @(Flag(menu, @"unlock")), @"other" : @(Flag(menu, @"other")), @"note" : note.length ? note : NSNull.null};
}

NSArray<NSString *> *PickPath(NSString *pick) {
  NSMutableArray<NSString *> *path = [NSMutableArray array];
  for (NSString *part in [pick componentsSeparatedByString:kPathSeparator]) {
    NSString *trimmed = [part stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (trimmed.length) [path addObject:trimmed];
  }
  return path;
}

NSMenuItem *FindPath(NSArray<NSMenuItem *> *items, NSArray<NSString *> *path) {
  NSMenuItem *found = nil;
  for (NSString *title in path) {
    found = nil;
    for (NSMenuItem *item in items)
      if (!item.isSeparatorItem && [item.title isEqualToString:title]) {
        found = item;
        break;
      }
    if (!found) return nil;
    items = found.submenu.itemArray ?: @[];
  }
  return found;
}

NSMenuItem *FindTitle(NSArray<NSMenuItem *> *items, NSString *title) {
  for (NSMenuItem *item in items) {
    if (!item.isSeparatorItem && [item.title isEqualToString:title] && item.action) return item;
    if (NSMenuItem *inner = FindTitle(item.submenu.itemArray ?: @[], title)) return inner;
  }
  return nil;
}

}

@interface ArdiaVaultContext : NSObject
@property(nonatomic, copy) NSString *frameId;
@property(nonatomic, copy) NSString *origin;
@property(nonatomic) CFTimeInterval at;
@property(nonatomic) BOOL shown;
@property(nonatomic, copy) NSDictionary *model;
@property(nonatomic, weak) ArdiaWebView *view;
@property(nonatomic, strong) NSHashTable<NSMenu *> *autofillMenus;
@property(nonatomic, strong) NSArray<NSMenuItem *> *topItems;
@property(nonatomic, copy) NSArray<NSString *> *pendingPick;
@property(nonatomic, copy) void (^redump)(NSArray<NSDictionary *> *described);
@end

@implementation ArdiaVaultContext

- (instancetype)init {
  if ((self = [super init])) _autofillMenus = [NSHashTable weakObjectsHashTable];
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

- (NSMenu *)submenuTitled:(NSString *)title {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:title];
  menu.autoenablesItems = NO;
  return menu;
}

- (void)fillAutofillMenu:(NSMenu *)menu {
  [menu removeAllItems];
  NSDictionary *model = self.model;
  if (!model) {
    [menu addItem:[self note:kLoadingTitle]];
    return;
  }
  for (NSDictionary *login in model[@"logins"]) {
    NSMenuItem *row = [[NSMenuItem alloc] initWithTitle:login[@"title"] action:nil keyEquivalent:@""];
    NSMenu *choices = [self submenuTitled:login[@"title"]];
    for (NSString *field in ContextChoices())
      if ([login[@"fields"] containsObject:field])
        [choices addItem:[self choice:ContextChoiceTitles()[field] action:@{@"action" : @"fill", @"login" : login[@"key"], @"field" : field}]];
    row.submenu = choices;
    [menu addItem:row];
  }
  if ([model[@"note"] isKindOfClass:NSString.class]) [menu addItem:[self note:model[@"note"]]];
  const BOOL unlock = Flag(model, @"unlock"), other = Flag(model, @"other");
  if ((unlock || other) && menu.numberOfItems) [menu addItem:NSMenuItem.separatorItem];
  if (unlock) [menu addItem:[self choice:kUnlockTitle action:@{@"action" : @"unlock"}]];
  if (other) [menu addItem:[self choice:kOtherTitle action:@{@"action" : @"other"}]];
  if (!menu.numberOfItems) [menu addItem:[self note:kLoadingTitle]];
}

- (NSArray<NSMenuItem *> *)makeTopItems {
  NSMutableArray<NSMenuItem *> *items = [NSMutableArray array];
  if (gContextAutofill) {
    NSMenuItem *autofill = [[NSMenuItem alloc] initWithTitle:kAutofillTitle action:nil keyEquivalent:@""];
    NSMenu *menu = [self submenuTitled:kAutofillTitle];
    [self fillAutofillMenu:menu];
    [self.autofillMenus addObject:menu];
    autofill.submenu = menu;
    [items addObject:autofill];
  }
  if (gContextGenerators.count) {
    NSMenuItem *generate = [[NSMenuItem alloc] initWithTitle:kGenerateTitle action:nil keyEquivalent:@""];
    NSMenu *menu = [self submenuTitled:kGenerateTitle];
    for (NSDictionary<NSString *, NSString *> *style in gContextGenerators)
      [menu addItem:[self choice:style[@"title"] action:@{@"action" : @"generate", @"style" : style[@"style"]}]];
    generate.submenu = menu;
    [items addObject:generate];
  }
  self.topItems = items;
  return items;
}

- (void)choose:(NSMenuItem *)sender {
  NSDictionary *action = [sender.representedObject isKindOfClass:NSDictionary.class] ? sender.representedObject : nil;
  ArdiaWebView *view = self.view;
  if (!action || !view) return;
  NSMutableDictionary *payload = [action mutableCopy];
  payload[@"frameId"] = self.frameId;
  payload[@"origin"] = self.origin;
  dispatch_async(dispatch_get_main_queue(), ^{
    [view emit:@"vaultContextAction" payload:payload];
  });
}

- (BOOL)pick:(NSArray<NSString *> *)path {
  NSMenuItem *item = path.count > 1 ? FindPath(self.topItems, path) : FindTitle(self.topItems, path.firstObject ?: @"");
  if (!item.action || !item.enabled) return NO;
  [self choose:item];
  return YES;
}

- (void)adoptModel:(NSDictionary *)model {
  self.model = model;
  for (NSMenu *menu in self.autofillMenus.allObjects) [self fillAutofillMenu:menu];
  if (self.redump) self.redump([self.view describeVaultContextItems:self.topItems]);
  NSArray<NSString *> *pending = self.pendingPick;
  self.pendingPick = nil;
  if (pending) [self pick:pending];
}

@end

namespace {

ArdiaWebView *WebViewAbove(NSView *view) {
  for (NSView *at = view; at; at = at.superview)
    if ([at isKindOfClass:ArdiaWebView.class]) return (ArdiaWebView *)at;
  return nil;
}

void AddVaultContextItems(NSMenu *menu, NSView *view) {
  NSArray<NSMenuItem *> *items = [WebViewAbove(view) takeVaultContextMenuItems];
  if (!items.count) return;
  NSInteger at = 0;
  for (NSMenuItem *item in items) [menu insertItem:item atIndex:at++];
  if (menu.numberOfItems > at && ![menu itemAtIndex:at].isSeparatorItem) [menu insertItem:NSMenuItem.separatorItem atIndex:at];
}

void InstallVaultContextMenuHook() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    SEL selector = @selector(popUpContextMenu:withEvent:forView:);
    ardia_runtime::ReplaceMethod(object_getClass(NSMenu.class), selector, ^id(IMP original) {
      return ^(id menuClass, NSMenu *menu, NSEvent *event, NSView *view) {
        AddVaultContextItems(menu, view);
        ((void (*)(id, SEL, NSMenu *, NSEvent *, NSView *))original)(menuClass, selector, menu, event, view);
      };
    });
  });
}

}

@implementation ArdiaWebView (VaultContextMenu)

+ (void)setVaultContextAutofill:(BOOL)autofill generators:(NSArray<NSDictionary<NSString *, id> *> *)generators {
  NSMutableArray<NSDictionary<NSString *, NSString *> *> *kept = [NSMutableArray array];
  for (NSDictionary *generator in generators) {
    NSString *style = Text(generator, @"style", 32);
    NSString *title = Text(generator, @"title", 120);
    if (kept.count < kMaxGenerators && title.length && [GeneratorStyles() containsObject:style ?: @""]) [kept addObject:@{@"style" : style, @"title" : title}];
  }
  gContextAutofill = autofill;
  gContextGenerators = kept;
  if (autofill || kept.count) InstallVaultContextMenuHook();
}

- (ArdiaVaultContext *)vaultContext {
  return objc_getAssociatedObject(self, &kVaultContextKey);
}

- (void)noteVaultContext:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main origin:(NSString *)origin {
  const BOOL offered = gContextAutofill || gContextGenerators.count;
  if (!Flag(dict, @"field") || !offered || !frameId.length || !ContextSecureOrigin(origin ?: @"")) {
    objc_setAssociatedObject(self, &kVaultContextKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return;
  }
  ArdiaVaultContext *context = [ArdiaVaultContext new];
  context.frameId = frameId;
  context.origin = origin;
  context.at = CACurrentMediaTime();
  context.view = self;
  objc_setAssociatedObject(self, &kVaultContextKey, context, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  NSString *kind = Text(dict, @"kind", 16);
  NSString *guess = Text(dict, @"guess", 16);
  NSDictionary *rect = Field<NSDictionary>(dict, @"rect");
  double x, y, width, height, length;
  id box = NSNull.null;
  if (main && Finite(rect, @"x", &x) && Finite(rect, @"y", &y) && Finite(rect, @"width", &width) && Finite(rect, @"height", &height))
    box = @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)};
  const NSInteger maxLength = Finite(dict, @"maxLength", &length) && length > 0 ? (NSInteger)floor(MIN(length, kMaxContextLength)) : 0;
  [self emit:@"vaultContext"
      payload:@{
        @"frameId" : frameId,
        @"origin" : origin,
        @"main" : @(main),
        @"kind" : [ContextFieldKinds() containsObject:kind ?: @""] ? kind : NSNull.null,
        @"guess" : [ContextChoices() containsObject:guess ?: @""] ? guess : @"username",
        @"rect" : box,
        @"maxLength" : @(maxLength),
      }];
}

- (NSArray<NSMenuItem *> *)takeVaultContextMenuItems {
  ArdiaVaultContext *context = self.vaultContext;
  if (!context || context.shown || CACurrentMediaTime() - context.at > kContextFieldFreshSeconds) return @[];
  context.shown = YES;
  return [context makeTopItems];
}

- (void)applyVaultContextMenu:(NSDictionary<NSString *, id> *)menu frame:(NSString *)frameId origin:(NSString *)origin {
  ArdiaVaultContext *context = self.vaultContext;
  if (!context || ![context.frameId isEqualToString:frameId] || ![context.origin isEqualToString:origin]) return;
  [context adoptModel:ContextMenuModel(menu)];
}

- (void)armVaultContextFill {
  objc_setAssociatedObject(self, &kVaultContextFillKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)disarmVaultContextFill {
  objc_setAssociatedObject(self, &kVaultContextFillKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (BOOL)takeVaultContextFill {
  const BOOL armed = [objc_getAssociatedObject(self, &kVaultContextFillKey) boolValue];
  [self disarmVaultContextFill];
  return armed;
}

- (BOOL)pickVaultContextMenu:(NSString *)pick redump:(void (^)(NSArray<NSDictionary *> *described))redump {
  ArdiaVaultContext *context = self.vaultContext;
  if (!context.topItems.count) return NO;
  context.redump = redump;
  NSArray<NSString *> *path = PickPath(pick ?: @"");
  if (!path.count) return NO;
  if ([context pick:path]) return YES;
  const BOOL autofillPath = path.count > 1 && [path.firstObject isEqualToString:kAutofillTitle];
  if (!autofillPath || context.model) return NO;
  context.pendingPick = path;
  return YES;
}

- (NSArray<NSDictionary *> *)describeVaultContextItems:(NSArray<NSMenuItem *> *)items {
  constexpr int kCommand = 0, kSeparator = 3, kSubmenu = 5;
  NSMutableArray<NSDictionary *> *described = [NSMutableArray array];
  for (NSMenuItem *item in items) {
    NSMutableDictionary *entry = [@{
      @"id" : @0,
      @"label" : item.isSeparatorItem ? @"" : [item.title stringByReplacingOccurrencesOfString:@"&" withString:@"&&"],
      @"enabled" : @(item.isSeparatorItem || item.enabled),
      @"visible" : @YES,
      @"type" : @(item.isSeparatorItem ? kSeparator : item.submenu ? kSubmenu : kCommand),
    } mutableCopy];
    if (item.submenu) entry[@"submenu"] = [self describeVaultContextItems:item.submenu.itemArray];
    [described addObject:entry];
  }
  return described;
}

@end
