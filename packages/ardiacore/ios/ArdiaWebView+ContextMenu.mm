#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"
#import "ArdiaLaunchConfig.h"

#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

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

constexpr int64_t kSharedImageLifetime = 3600;

NSString *SharedImagesRoot() {
  ArdiaLaunchConfig *config = ArdiaLaunchConfig.shared;
  NSString *base = config.isolated && config.dataDirectory.length ? config.dataDirectory : NSTemporaryDirectory();
  return [base stringByAppendingPathComponent:@"Ardia Shared Images"].stringByStandardizingPath;
}

bool IsPrivateDirectory(NSString *path) {
  struct stat found;
  return lstat(path.fileSystemRepresentation, &found) == 0 && S_ISDIR(found.st_mode) && found.st_uid == getuid();
}

bool MakePrivateDirectory(NSString *path) {
  if (mkdir(path.fileSystemRepresentation, 0700) == 0) return true;
  return errno == EEXIST && IsPrivateDirectory(path) && chmod(path.fileSystemRepresentation, 0700) == 0;
}

bool IsUUID(NSString *name) {
  return [[NSUUID alloc] initWithUUIDString:name] != nil;
}

bool IsOwnerName(NSString *name) {
  const NSRange dash = [name rangeOfString:@"-"];
  if (dash.location == NSNotFound || dash.location == 0) return false;
  NSString *pid = [name substringToIndex:dash.location];
  return [pid rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet].location == NSNotFound &&
         IsUUID([name substringFromIndex:NSMaxRange(dash)]);
}

NSArray<NSString *> *EntriesOf(NSString *path) {
  return [NSFileManager.defaultManager contentsOfDirectoryAtPath:path error:nil] ?: @[];
}

bool RemoveShareFolder(NSString *path) {
  if (!IsUUID(path.lastPathComponent) || !IsPrivateDirectory(path)) return false;
  NSArray<NSString *> *names = EntriesOf(path);
  for (NSString *name in names) {
    struct stat found;
    if (lstat([path stringByAppendingPathComponent:name].fileSystemRepresentation, &found) != 0 || !S_ISREG(found.st_mode)) return false;
  }
  for (NSString *name in names) unlink([path stringByAppendingPathComponent:name].fileSystemRepresentation);
  return rmdir(path.fileSystemRepresentation) == 0;
}

void RemoveIfOwnerGone(NSString *owner) {
  if (!IsPrivateDirectory(owner)) return;
  NSString *lock = [owner stringByAppendingPathComponent:@".lock"];
  const int fd = open(lock.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return;
  struct stat found;
  if (fstat(fd, &found) == 0 && S_ISREG(found.st_mode) && flock(fd, LOCK_EX | LOCK_NB) == 0) {
    bool emptied = true;
    for (NSString *name in EntriesOf(owner))
      if (![name isEqualToString:@".lock"]) emptied = RemoveShareFolder([owner stringByAppendingPathComponent:name]) && emptied;
    if (emptied && unlink(lock.fileSystemRepresentation) == 0) rmdir(owner.fileSystemRepresentation);
  }
  close(fd);
}

constexpr NSUInteger kKeptShareFolders = 10;

NSString *gOwnFolder = nil;

void KeepNewestShares(NSString *owner, NSUInteger kept) {
  NSMutableArray<NSString *> *shares = [NSMutableArray array];
  NSMutableDictionary<NSString *, NSNumber *> *made = [NSMutableDictionary dictionary];
  for (NSString *name in EntriesOf(owner)) {
    struct stat found;
    NSString *path = [owner stringByAppendingPathComponent:name];
    if (!IsUUID(name) || lstat(path.fileSystemRepresentation, &found) != 0) continue;
    [shares addObject:path];
    made[path] = @(found.st_birthtimespec.tv_sec * 1e9 + found.st_birthtimespec.tv_nsec);
  }
  if (shares.count <= kept) return;
  [shares sortUsingComparator:^NSComparisonResult(NSString *a, NSString *b) { return [made[a] compare:made[b]]; }];
  for (NSUInteger i = 0; i < shares.count - kept; i++) RemoveShareFolder(shares[i]);
}

NSString *OwnFolder() {
  static NSString *own;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *root = SharedImagesRoot();
    NSString *folder = [root stringByAppendingPathComponent:[NSString stringWithFormat:@"%d-%@", getpid(), NSUUID.UUID.UUIDString]];
    if (!MakePrivateDirectory(root) || !MakePrivateDirectory(folder)) return;
    NSString *lock = [folder stringByAppendingPathComponent:@".lock"];
    if (open(lock.fileSystemRepresentation, O_RDONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_EXLOCK | O_NONBLOCK, 0600) >= 0) own = folder;
    gOwnFolder = own;
  });
  return own;
}

NSURL *SharedImageFile(NSData *image, NSString *mimeType, NSString *source) {
  static NSDictionary<NSString *, NSString *> *extensions =
      @{@"image/png" : @"png", @"image/jpeg" : @"jpg", @"image/gif" : @"gif", @"image/webp" : @"webp"};
  NSString *name = [[NSURL URLWithString:source ?: @""].lastPathComponent stringByDeletingPathExtension];
  name = [[name stringByReplacingOccurrencesOfString:@":" withString:@"-"] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
  if (!name.length || [name isEqualToString:@"/"]) name = @"Image";
  if (name.length > 80) name = [name substringToIndex:[name rangeOfComposedCharacterSequenceAtIndex:80].location];
  NSString *own = OwnFolder();
  if (!own) return nil;
  KeepNewestShares(own, kKeptShareFolders - 1);
  NSString *folder = [own stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  if (!MakePrivateDirectory(folder)) return nil;
  NSURL *file = [NSURL fileURLWithPath:[folder stringByAppendingPathComponent:[name stringByAppendingPathExtension:extensions[mimeType.lowercaseString] ?: @"jpg"]]];
  if (![image writeToURL:file options:NSDataWritingAtomic error:nil]) {
    RemoveShareFolder(folder);
    return nil;
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kSharedImageLifetime * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [ArdiaWebView removeSharedImage:file];
  });
  return file;
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

+ (void)removeSharedImage:(NSURL *)file {
  NSString *own = gOwnFolder;
  if (!file.fileURL || !own) return;
  NSString *folder = file.path.stringByStandardizingPath.stringByDeletingLastPathComponent;
  if ([folder.stringByDeletingLastPathComponent isEqualToString:own]) RemoveShareFolder(folder);
}

+ (void)removeSharedImages {
  NSString *root = SharedImagesRoot();
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    if (!IsPrivateDirectory(root)) return;
    for (NSString *name in EntriesOf(root)) {
      NSString *path = [root stringByAppendingPathComponent:name];
      if (IsUUID(name)) RemoveShareFolder(path);
      else if (IsOwnerName(name)) RemoveIfOwnerGone(path);
    }
  });
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

- (void)tab:(ArdiaCoreTab *)tab shareFromContextMenu:(NSDictionary<NSString *, id> *)share {
  NSMutableDictionary *item = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"kind", @"url", @"title", @"text" ])
    if (NSString *value = Field<NSString>(share, key)) item[key] = value;
  NSData *image = Field<NSData>(share, @"image");
  if (NSURL *file = image ? SharedImageFile(image, Field<NSString>(share, @"mimeType"), item[@"url"]) : nil)
    item[@"fileUrl"] = file.absoluteString;
  NSMutableDictionary *payload = [@{@"command" : @"share", @"text" : item[@"text"] ?: @"", @"share" : item} mutableCopy];
  NSArray<NSNumber *> *point = Field<NSArray>(share, @"point");
  NSView *content = self.window.contentView;
  if (point.count == 2 && content)
    payload[@"anchor"] = @[ @(point[0].doubleValue - 1), @(NSHeight(content.frame) - point[1].doubleValue - 1), @2, @2 ];
  [self emit:@"command" payload:payload];
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
