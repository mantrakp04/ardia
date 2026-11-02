#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"
#import "ArdiaLaunchConfig.h"

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace {

NSString *gSearchEngineName = @"Google";

NSString *SelectionLabel(NSString *text) {
  NSArray *words = [text componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *collapsed = [[words filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]]
      componentsJoinedByString:@" "];
  if (collapsed.length <= 50) return collapsed;
  NSRange space = [collapsed rangeOfString:@" " options:NSBackwardsSearch range:NSMakeRange(0, 50)];
  NSUInteger end = space.location != NSNotFound && space.location > 25 ? space.location : 50;
  end = [collapsed rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, end)].length;
  return [[collapsed substringToIndex:end] stringByAppendingString:@"…"];
}

constexpr int kMenuSeparator = 3;

int MenuItemType(NSDictionary *item) {
  if (NSNumber *type = Field<NSNumber>(item, @"type")) return type.intValue;
  return Flag(item, @"separator") ? kMenuSeparator : 0;
}

NSString *MenuTitle(NSString *label);

NSArray *DescribeMenu(NSArray *items) {
  NSMutableArray *out = [NSMutableArray array];
  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    static const int kDescribedMenuTypes[] = {1, 2, 3, 4, 0, 5, 5};
    const int type = MenuItemType(item);
    NSMutableDictionary *described = [@{
      @"id" : Field<NSNumber>(item, @"id") ?: @0,
      @"label" : MenuTitle(Field<NSString>(item, @"label") ?: @""),
      @"type" : @(type >= 0 && type < 7 ? kDescribedMenuTypes[type] : 0),
      @"enabled" : @(Flag(item, @"enabled")),
      @"visible" : @(Field<NSNumber>(item, @"visible") ? Flag(item, @"visible") : YES),
    } mutableCopy];
    if (NSArray *submenu = Field<NSArray>(item, @"submenu")) described[@"submenu"] = DescribeMenu(submenu);
    [out addObject:described];
  }
  return out;
}

NSString *MenuTitle(NSString *label) {
  NSMutableString *title = [NSMutableString stringWithCapacity:label.length];
  for (NSUInteger i = 0; i < label.length; i++) {
    const unichar c = [label characterAtIndex:i];
    if (c != '&') {
      [title appendFormat:@"%C", c];
    } else if (i + 1 < label.length && [label characterAtIndex:i + 1] == '&') {
      [title appendString:@"&"];
      i++;
    }
  }
  return title;
}

NSDictionary *FindMenuItem(NSArray *items, NSString *label) {
  for (NSUInteger i = 0; i < items.count; i++) {
    NSDictionary *item = items[i];
    if (![item isKindOfClass:NSDictionary.class]) continue;
    if ([MenuTitle(Field<NSString>(item, @"label") ?: @"") isEqualToString:label]) {
      NSNumber *command = Field<NSNumber>(item, @"id");
      return command ? @{@"command" : command, @"path" : @[ @(i) ]} : nil;
    }
    if (NSDictionary *found = FindMenuItem(Field<NSArray>(item, @"submenu"), label))
      return @{@"command" : found[@"command"], @"path" : [@[ @(i) ] arrayByAddingObjectsFromArray:found[@"path"]]};
  }
  return nil;
}
}

@implementation ArdiaWebView (ContextMenu)

+ (void)setSearchEngineName:(NSString *)name {
  gSearchEngineName = name.length ? [name copy] : @"Google";
}

- (NSArray<NSDictionary<NSString *, NSString *> *> *)tab:(ArdiaCoreTab *)tab
                           contextMenuItemsForSelection:(NSString *)text {
  return @[ @{
    @"id" : @"search",
    @"title" : [NSString stringWithFormat:@"Search %@ for “%@”", gSearchEngineName, SelectionLabel(text)],
    @"replaces" : @"search",
  } ];
}

- (void)tab:(ArdiaCoreTab *)tab
    contextMenuCommand:(NSString *)itemId
                  text:(NSString *)selection
             modifiers:(NSDictionary<NSString *, NSNumber *> *)modifiers {
  if ([itemId isEqualToString:@"search"])
    [self emit:@"command" payload:@{@"command" : @"search", @"text" : selection ?: @"", @"modifiers" : modifiers ?: @{}}];
}

- (void)tab:(ArdiaCoreTab *)tab didShowAutofillSuggestions:(NSArray<NSDictionary<NSString *, NSString *> *> *)items {
  NoteEvent(ardia_host::BrowserId(tab), @"autofillSuggestions", @{@"items" : items ?: @[]});
}

- (void)tab:(ArdiaCoreTab *)tab didShowContextMenu:(NSArray<NSDictionary *> *)items {
  [self tab:tab runContextMenu:@{@"items" : items ?: @[]}];
}

- (NSDictionary<NSString *, id> *)tab:(ArdiaCoreTab *)tab runContextMenu:(NSDictionary<NSString *, id> *)menu {
  NSArray *items = Field<NSArray>(menu, @"items") ?: @[];
  NoteEvent(ardia_host::BrowserId(tab), @"contextMenu", @{@"items" : items});
  ArdiaLaunchConfig *config = ArdiaLaunchConfig.shared;
  if (![config testFlag:@"contextMenu"]) {
    if (ardia_host::Background()) {
      NSMutableArray<NSString *> *titles = [NSMutableArray array];
      for (NSDictionary *item in items)
        if (MenuItemType(item) != kMenuSeparator && Field<NSString>(item, @"label").length) [titles addObject:MenuTitle(item[@"label"])];
      ardia_host::LogActivation([NSString stringWithFormat:@"context menu (not shown): %@", [titles componentsJoinedByString:@" | "]]);
    }
    return nil;
  }
  NSString *path = [config.dataDirectory stringByAppendingPathComponent:@"context-menu.json"];
  NSString *pickPath = [path stringByAppendingString:@".pick"];
  NSDictionary *dump = @{
    @"url" : Field<NSString>(menu, @"url") ?: tab.url ?: @"",
    @"link" : Field<NSString>(menu, @"link") ?: @"",
    @"items" : DescribeMenu(items),
  };
  [JSONText(dump) writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSString *pick = [NSString stringWithContentsOfFile:pickPath encoding:NSUTF8StringEncoding error:nil];
  [NSFileManager.defaultManager removeItemAtPath:pickPath error:nil];
  pick = [pick stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSArray<NSString *> *parts = [pick componentsSeparatedByString:@"\t"];
  NSDictionary *found = pick.length ? FindMenuItem(items, parts[0]) : nil;
  if (!found) return nil;
  return @{@"command" : found[@"command"], @"path" : found[@"path"], @"flags" : @(parts.count > 1 ? parts[1].intValue : 0)};
}

@end
