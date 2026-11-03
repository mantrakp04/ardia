#import "ArdiaDownloadMover.h"

#include <fcntl.h>
#include <os/lock.h>
#include <pwd.h>
#include <stdio.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <unistd.h>

namespace {

NSString *const kMovedDefault = @"ArdiaMovedDownloads";
constexpr NSUInteger kMaxMoved = 200;
constexpr NSUInteger kMaxRecords = 1000;
constexpr int kMaxCollisions = 999;
constexpr NSUInteger kMaxNameBytes = 255;
constexpr NSUInteger kMaxKeptExtension = 24;

class ScopedFd {
 public:
  explicit ScopedFd(int fd = -1) : fd_(fd) {}
  ~ScopedFd() { reset(); }
  ScopedFd(const ScopedFd &) = delete;
  ScopedFd &operator=(const ScopedFd &) = delete;
  int get() const { return fd_; }
  bool valid() const { return fd_ >= 0; }
  void reset(int fd = -1) {
    if (fd_ >= 0) close(fd_);
    fd_ = fd;
  }

 private:
  int fd_;
};

NSDictionary *Failure(NSString *reason) {
  return @{@"ok" : @NO, @"reason" : reason};
}

NSArray<NSString *> *FolderComponents(NSString *folder) {
  if (![folder isKindOfClass:NSString.class] || ![folder hasPrefix:@"~/"]) return nil;
  NSString *rest = [folder substringFromIndex:2];
  while ([rest hasSuffix:@"/"]) rest = [rest substringToIndex:rest.length - 1];
  if (!rest.length) return nil;
  NSArray<NSString *> *parts = [rest componentsSeparatedByString:@"/"];
  for (NSString *part in parts)
    if (!part.length || [part isEqualToString:@"."] || [part isEqualToString:@".."] || [part containsString:@"\0"]) return nil;
  return parts;
}

bool HasPrefix(NSArray<NSString *> *components, NSArray<NSString *> *prefix) {
  if (prefix.count > components.count) return false;
  for (NSUInteger i = 0; i < prefix.count; i++)
    if (![components[i] isEqualToString:prefix[i]]) return false;
  return true;
}

NSString *ReasonForMissingDirectory(int parent, NSString *name) {
  struct stat info;
  if (fstatat(parent, name.fileSystemRepresentation, &info, AT_SYMLINK_NOFOLLOW) != 0)
    return errno == ENOENT ? @"folderMissing" : @"folderUnreadable";
  if (S_ISLNK(info.st_mode)) return @"symlink";
  if (!S_ISDIR(info.st_mode)) return @"notAFolder";
  return @"folderUnreadable";
}

NSString *Truncated(NSString *text, NSUInteger maxBytes) {
  if ([text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <= maxBytes) return text;
  NSMutableString *kept = [NSMutableString string];
  __block NSUInteger bytes = 0;
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString *piece, NSRange, NSRange, BOOL *stop) {
                          const NSUInteger size = [piece lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
                          if (bytes + size > maxBytes) {
                            *stop = YES;
                            return;
                          }
                          bytes += size;
                          [kept appendString:piece];
                        }];
  return kept;
}

void SplitName(NSString *name, NSString **stem, NSString **extension) {
  NSString *ext = name.pathExtension;
  NSString *base = name.stringByDeletingPathExtension;
  if (ext.length && [base.pathExtension.lowercaseString isEqualToString:@"tar"]) {
    ext = [@"tar." stringByAppendingString:ext];
    base = base.stringByDeletingPathExtension;
  }
  if (!base.length || ext.length > kMaxKeptExtension) {
    base = name;
    ext = @"";
  }
  *stem = base;
  *extension = ext;
}

NSString *NameWithSuffix(NSString *name, NSString *suffix) {
  NSString *stem, *ext;
  SplitName(name, &stem, &ext);
  NSString *tail = ext.length ? [NSString stringWithFormat:@"%@.%@", suffix, ext] : suffix;
  const NSUInteger tailBytes = [tail lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
  return [Truncated(stem, kMaxNameBytes - MIN(tailBytes, kMaxNameBytes - 1)) stringByAppendingString:tail];
}

bool SameFile(const struct stat &a, NSArray<NSNumber *> *identity) {
  return identity.count == 2 && (uint64_t)a.st_dev == identity[0].unsignedLongLongValue &&
         (uint64_t)a.st_ino == identity[1].unsignedLongLongValue;
}

NSString *DirectoryPath(int fd) {
  char path[MAXPATHLEN];
  return fcntl(fd, F_GETPATH, path) == 0 ? @(path) : nil;
}

}

@implementation ArdiaDownloadMover {
  os_unfair_lock _lock;
  NSString *_home;
  NSUserDefaults *_defaults;
  NSArray<NSArray<NSString *> *> *_approved;
  NSMutableDictionary<NSString *, NSDictionary *> *_records;
  NSMutableArray<NSString *> *_recordOrder;
  NSMutableDictionary<NSString *, NSArray<NSNumber *> *> *_finishedFiles;
  NSMutableArray<NSDictionary *> *_moved;
}

+ (ArdiaDownloadMover *)shared {
  static ArdiaDownloadMover *mover;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    const struct passwd *user = getpwuid(getuid());
    NSString *home = user && user->pw_dir ? @(user->pw_dir) : NSHomeDirectory();
    mover = [[ArdiaDownloadMover alloc] initWithHome:home defaults:NSUserDefaults.standardUserDefaults];
  });
  return mover;
}

- (instancetype)initWithHome:(NSString *)home defaults:(NSUserDefaults *)defaults {
  if ((self = [super init])) {
    _lock = OS_UNFAIR_LOCK_INIT;
    _home = [home copy];
    _defaults = defaults;
    _approved = @[];
    _records = [NSMutableDictionary dictionary];
    _recordOrder = [NSMutableArray array];
    _finishedFiles = [NSMutableDictionary dictionary];
    _moved = [NSMutableArray array];
    for (id entry in [[defaults arrayForKey:kMovedDefault] ?: @[] copy])
      if ([entry isKindOfClass:NSDictionary.class] && [entry[@"id"] isKindOfClass:NSString.class] &&
          [entry[@"from"] isKindOfClass:NSString.class] && [entry[@"to"] isKindOfClass:NSString.class])
        [_moved addObject:entry];
  }
  return self;
}

- (NSDictionary *)movedEntryFor:(NSString *)downloadId {
  for (NSDictionary *entry in _moved.reverseObjectEnumerator)
    if ([entry[@"id"] isEqualToString:downloadId]) return entry;
  return nil;
}

- (NSDictionary *)noteDownloadEvent:(NSDictionary *)download {
  NSString *downloadId = [download[@"id"] isKindOfClass:NSString.class] ? download[@"id"] : nil;
  if (!downloadId.length) return download;
  os_unfair_lock_lock(&_lock);
  NSDictionary *event = download;
  NSDictionary *moved = [self movedEntryFor:downloadId];
  if (moved && [download[@"path"] isEqual:moved[@"from"]]) {
    NSMutableDictionary *rewritten = [download mutableCopy];
    rewritten[@"path"] = moved[@"to"];
    rewritten[@"filename"] = [moved[@"to"] lastPathComponent];
    event = rewritten;
  }
  if (!_records[downloadId]) {
    [_recordOrder addObject:downloadId];
    if (_recordOrder.count > kMaxRecords) {
      NSString *oldest = _recordOrder.firstObject;
      [_recordOrder removeObjectAtIndex:0];
      [_records removeObjectForKey:oldest];
      [_finishedFiles removeObjectForKey:oldest];
    }
  }
  _records[downloadId] = event;
  NSString *path = [event[@"path"] isKindOfClass:NSString.class] ? event[@"path"] : nil;
  if (!_finishedFiles[downloadId] && [event[@"state"] isEqual:@"finished"] && ![event[@"dangerous"] boolValue] &&
      ![event[@"offTheRecord"] boolValue] && path.length) {
    struct stat info;
    if (lstat(path.fileSystemRepresentation, &info) == 0 && S_ISREG(info.st_mode))
      _finishedFiles[downloadId] = @[ @((uint64_t)info.st_dev), @((uint64_t)info.st_ino) ];
  }
  os_unfair_lock_unlock(&_lock);
  return event;
}

- (void)setApprovedFolders:(NSArray<NSString *> *)folders {
  NSMutableArray *approved = [NSMutableArray array];
  for (id folder in folders)
    if (NSArray *components = FolderComponents(folder)) [approved addObject:components];
  os_unfair_lock_lock(&_lock);
  _approved = approved;
  os_unfair_lock_unlock(&_lock);
}

- (NSDictionary *)moveDownloadAt:(NSString *)path toFolder:(NSString *)folder {
  os_unfair_lock_lock(&_lock);
  NSDictionary *result = [self lockedMove:path toFolder:folder];
  os_unfair_lock_unlock(&_lock);
  return result;
}

- (NSDictionary *)lockedMove:(NSString *)path toFolder:(NSString *)folder {
  if (![path isKindOfClass:NSString.class] || !path.length) return Failure(@"notADownload");
  NSString *downloadId = nil;
  for (NSString *candidate in _recordOrder.reverseObjectEnumerator)
    if ([_records[candidate][@"path"] isEqual:path]) {
      downloadId = candidate;
      break;
    }
  NSDictionary *record = downloadId ? _records[downloadId] : nil;
  if (!record) return Failure(@"notADownload");
  if ([record[@"offTheRecord"] boolValue]) return Failure(@"private");
  if ([record[@"dangerous"] boolValue]) return Failure(@"dangerous");
  if (![record[@"state"] isEqual:@"finished"]) return Failure(@"notFinished");
  NSArray<NSNumber *> *identity = _finishedFiles[downloadId];
  if (!identity) return Failure(@"missing");

  NSArray<NSString *> *components = FolderComponents(folder);
  if (!components) return Failure(@"folderNotAllowed");
  NSUInteger rootLength = 0;
  for (NSArray<NSString *> *root in [_approved arrayByAddingObject:@[ @"Downloads" ]])
    if (HasPrefix(components, root)) rootLength = MAX(rootLength, root.count);
  if (!rootLength) return Failure(@"folderNotAllowed");

  ScopedFd destination(open(_home.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (!destination.valid()) return Failure(@"folderUnreadable");
  for (NSUInteger i = 0; i < components.count; i++) {
    const char *name = components[i].fileSystemRepresentation;
    int next = openat(destination.get(), name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0 && errno == ENOENT && i + 1 >= rootLength) {
      if (mkdirat(destination.get(), name, 0755) != 0 && errno != EEXIST) return Failure(@"folderNotCreated");
      next = openat(destination.get(), name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    }
    if (next < 0) return Failure(ReasonForMissingDirectory(destination.get(), components[i]));
    destination.reset(next);
  }

  NSString *sourceName = path.lastPathComponent;
  ScopedFd source(open(path.stringByDeletingLastPathComponent.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (!source.valid()) return Failure(@"missing");
  struct stat file;
  if (fstatat(source.get(), sourceName.fileSystemRepresentation, &file, AT_SYMLINK_NOFOLLOW) != 0) return Failure(@"missing");
  if (!S_ISREG(file.st_mode)) return Failure(@"notAFile");
  if (!SameFile(file, identity)) return Failure(@"changed");

  struct stat sourceDir, destinationDir;
  if (fstat(source.get(), &sourceDir) != 0 || fstat(destination.get(), &destinationDir) != 0) return Failure(@"failed");
  if (sourceDir.st_dev == destinationDir.st_dev && sourceDir.st_ino == destinationDir.st_ino) return @{@"ok" : @YES, @"path" : path};
  if (sourceDir.st_dev != destinationDir.st_dev) return Failure(@"crossesVolumes");

  NSString *safe = [ArdiaDownloadMover safeFileName:sourceName];
  NSString *placed = nil;
  for (int n = 0; n <= kMaxCollisions && !placed; n++) {
    NSString *candidate = n ? NameWithSuffix(safe, [NSString stringWithFormat:@" (%d)", n]) : safe;
    if (renameatx_np(source.get(), sourceName.fileSystemRepresentation, destination.get(), candidate.fileSystemRepresentation,
                     RENAME_EXCL) == 0) {
      placed = candidate;
      break;
    }
    if (errno == EEXIST) continue;
    if (errno == EXDEV) return Failure(@"crossesVolumes");
    if (errno == ENOENT) return Failure(@"missing");
    return Failure(@"failed");
  }
  if (!placed) return Failure(@"tooManyCollisions");

  struct stat moved;
  if (fstatat(destination.get(), placed.fileSystemRepresentation, &moved, AT_SYMLINK_NOFOLLOW) != 0 || !SameFile(moved, identity)) {
    renameatx_np(destination.get(), placed.fileSystemRepresentation, source.get(), sourceName.fileSystemRepresentation, RENAME_EXCL);
    return Failure(@"changed");
  }

  NSString *directory = DirectoryPath(destination.get());
  if (!directory) {
    renameatx_np(destination.get(), placed.fileSystemRepresentation, source.get(), sourceName.fileSystemRepresentation, RENAME_EXCL);
    return Failure(@"failed");
  }
  NSString *finalPath = [directory stringByAppendingPathComponent:placed];
  NSDictionary *previous = [self movedEntryFor:downloadId];
  [_moved addObject:@{@"id" : downloadId, @"from" : previous[@"from"] ?: path, @"to" : finalPath}];
  if (_moved.count > kMaxMoved) [_moved removeObjectsInRange:NSMakeRange(0, _moved.count - kMaxMoved)];
  [_defaults setObject:[_moved copy] forKey:kMovedDefault];

  NSMutableDictionary *event = [record mutableCopy];
  event[@"path"] = finalPath;
  event[@"filename"] = placed;
  _records[downloadId] = event;
  return @{@"ok" : @YES, @"path" : finalPath, @"event" : event};
}

+ (NSString *)safeFileName:(NSString *)name {
  NSMutableString *clean = [NSMutableString string];
  [name enumerateSubstringsInRange:NSMakeRange(0, name.length)
                           options:NSStringEnumerationByComposedCharacterSequences
                        usingBlock:^(NSString *piece, NSRange, NSRange, BOOL *) {
                          const unichar c = [piece characterAtIndex:0];
                          if (c < 0x20 || c == 0x7F || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) ||
                              c == 0x200E || c == 0x200F || c == 0xFEFF)
                            return;
                          [clean appendString:c == '/' || c == ':' ? @"_" : piece];
                        }];
  NSCharacterSet *edges = NSCharacterSet.whitespaceAndNewlineCharacterSet;
  NSString *trimmed = [clean stringByTrimmingCharactersInSet:edges];
  while ([trimmed hasPrefix:@"."]) trimmed = [[trimmed substringFromIndex:1] stringByTrimmingCharactersInSet:edges];
  if (!trimmed.length) trimmed = @"download";
  if ([trimmed lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <= kMaxNameBytes) return trimmed;
  return NameWithSuffix(trimmed, @"");
}

@end
