#import "ArdiaDownloadMover.h"

#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <os/lock.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <unistd.h>

#include <vector>

namespace {

NSString *const kMovedDefault = @"ArdiaMovedDownloads";
NSString *const kStagingPrefix = @".ardia-moving-";
NSString *const kJournalDefault = @"ArdiaDownloadMoveJournal";
constexpr NSUInteger kMaxMoved = 200;
constexpr NSUInteger kMaxRecords = 1000;
constexpr int kMaxCollisions = 999;
constexpr int kMaxStagingTries = 16;
constexpr NSUInteger kMaxNameBytes = 255;
constexpr NSUInteger kMaxKeptExtension = 24;
constexpr size_t kHashChunk = 1 << 20;

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

NSDictionary *StagedFailure(NSString *reason, NSString *stagedPath) {
  return stagedPath ? @{@"ok" : @NO, @"reason" : reason, @"stagedPath" : stagedPath} : Failure(reason);
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

NSString *DirectoryPath(int fd) {
  char path[MAXPATHLEN];
  return fcntl(fd, F_GETPATH, path) == 0 ? @(path) : nil;
}

NSString *Sha256Of(int fd) {
  if (lseek(fd, 0, SEEK_SET) != 0) return nil;
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  std::vector<unsigned char> buffer(kHashChunk);
  while (true) {
    const ssize_t count = read(fd, buffer.data(), buffer.size());
    if (count < 0) {
      if (errno == EINTR) continue;
      return nil;
    }
    if (count == 0) break;
    CC_SHA256_Update(&context, buffer.data(), (CC_LONG)count);
  }
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (unsigned char byte : digest) [hex appendFormat:@"%02x", byte];
  return hex;
}

bool IsSha256(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] != CC_SHA256_DIGEST_LENGTH * 2) return false;
  NSCharacterSet *hex = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"];
  return [[value stringByTrimmingCharactersInSet:hex] length] == 0;
}

bool Restore(int staging, NSString *stagedName, int source, NSString *sourceName) {
  return renameatx_np(staging, stagedName.fileSystemRepresentation, source, sourceName.fileSystemRepresentation, RENAME_EXCL) == 0;
}

NSString *MakeStaging(int source) {
  for (int i = 0; i < kMaxStagingTries; i++) {
    NSString *name = [NSString stringWithFormat:@"%@%08x%08x", kStagingPrefix, arc4random(), arc4random()];
    if (mkdirat(source, name.fileSystemRepresentation, 0700) == 0) return name;
    if (errno != EEXIST) return nil;
  }
  return nil;
}

int OpenOwnStaging(int source, NSString *name) {
  const int fd = openat(source, name.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat info;
  if (fstat(fd, &info) != 0 || !S_ISDIR(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 077)) {
    close(fd);
    return -1;
  }
  return fd;
}

}

@implementation ArdiaDownloadMover {
  os_unfair_lock _lock;
  NSString *_home;
  NSUserDefaults *_defaults;
  NSArray<NSArray<NSString *> *> *_approved;
  NSMutableDictionary<NSString *, NSDictionary *> *_records;
  NSMutableArray<NSString *> *_recordOrder;
  NSMutableDictionary<NSString *, NSDictionary *> *_identities;
  NSMutableArray<NSDictionary *> *_moved;
  NSMutableSet<NSString *> *_inFlight;
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
    _identities = [NSMutableDictionary dictionary];
    _moved = [NSMutableArray array];
    _inFlight = [NSMutableSet set];
    for (id entry in [[defaults arrayForKey:kMovedDefault] ?: @[] copy])
      if ([entry isKindOfClass:NSDictionary.class] && [entry[@"id"] isKindOfClass:NSString.class] &&
          [entry[@"from"] isKindOfClass:NSString.class] && [entry[@"to"] isKindOfClass:NSString.class])
        [_moved addObject:entry];
    [self reconcileJournal];
  }
  return self;
}

- (void)lockedRemember:(NSString *)downloadId from:(NSString *)from to:(NSString *)to {
  NSDictionary *previous = [self movedEntryFor:downloadId];
  [_moved addObject:@{@"id" : downloadId, @"from" : previous[@"from"] ?: from, @"to" : to}];
  if (_moved.count > kMaxMoved) [_moved removeObjectsInRange:NSMakeRange(0, _moved.count - kMaxMoved)];
  [_defaults setObject:[_moved copy] forKey:kMovedDefault];
}

- (void)journal:(NSString *)downloadId entry:(NSDictionary *)entry {
  os_unfair_lock_lock(&_lock);
  NSMutableDictionary *journal = [[_defaults dictionaryForKey:kJournalDefault] mutableCopy] ?: [NSMutableDictionary dictionary];
  journal[downloadId] = entry;
  if (journal.count) [_defaults setObject:journal forKey:kJournalDefault];
  else [_defaults removeObjectForKey:kJournalDefault];
  os_unfair_lock_unlock(&_lock);
  [_defaults synchronize];
}

- (void)reconcileJournal {
  NSDictionary *journal = [_defaults dictionaryForKey:kJournalDefault];
  if (!journal.count) return;
  for (NSString *downloadId in journal) {
    NSDictionary *entry = [journal[downloadId] isKindOfClass:NSDictionary.class] ? journal[downloadId] : nil;
    NSString *source = entry[@"source"], *staging = entry[@"staging"], *name = entry[@"name"], *placed = entry[@"placed"];
    if (![source isKindOfClass:NSString.class] || ![staging isKindOfClass:NSString.class] || ![name isKindOfClass:NSString.class]) continue;
    NSString *staged = [staging stringByAppendingPathComponent:name];
    struct stat info;
    if ([placed isKindOfClass:NSString.class] && lstat(placed.fileSystemRepresentation, &info) == 0 && S_ISREG(info.st_mode)) {
      [self lockedRemember:downloadId from:source to:placed];
    } else if (lstat(staged.fileSystemRepresentation, &info) == 0 && S_ISREG(info.st_mode)) {
      const bool sourceFree = lstat(source.fileSystemRepresentation, &info) != 0 && errno == ENOENT;
      if (!sourceFree || renamex_np(staged.fileSystemRepresentation, source.fileSystemRepresentation, RENAME_EXCL) != 0)
        [self lockedRemember:downloadId from:source to:staged];
    }
    rmdir(staging.fileSystemRepresentation);
  }
  [_defaults removeObjectForKey:kJournalDefault];
  [_defaults synchronize];
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
      [_identities removeObjectForKey:oldest];
    }
  }
  _records[downloadId] = event;
  if (!_identities[downloadId] && [event[@"state"] isEqual:@"finished"] && ![event[@"dangerous"] boolValue] &&
      ![event[@"offTheRecord"] boolValue] && IsSha256(event[@"sha256"]) && [event[@"received"] isKindOfClass:NSNumber.class])
    _identities[downloadId] = @{@"sha256" : event[@"sha256"], @"size" : @([event[@"received"] longLongValue])};
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
  if (![path isKindOfClass:NSString.class] || !path.length) return Failure(@"notADownload");
  os_unfair_lock_lock(&_lock);
  NSString *downloadId = nil;
  for (NSString *candidate in _recordOrder.reverseObjectEnumerator)
    if ([_records[candidate][@"path"] isEqual:path]) {
      downloadId = candidate;
      break;
    }
  NSDictionary *record = downloadId ? _records[downloadId] : nil;
  NSDictionary *identity = downloadId ? _identities[downloadId] : nil;
  NSArray<NSArray<NSString *> *> *approved = _approved;
  NSString *refusal = nil;
  if (!record) refusal = @"notADownload";
  else if ([record[@"offTheRecord"] boolValue]) refusal = @"private";
  else if ([record[@"dangerous"] boolValue]) refusal = @"dangerous";
  else if (![record[@"state"] isEqual:@"finished"]) refusal = @"notFinished";
  else if (!identity) refusal = @"noIdentity";
  else if ([_inFlight containsObject:downloadId]) refusal = @"busy";
  if (!refusal) [_inFlight addObject:downloadId];
  os_unfair_lock_unlock(&_lock);
  if (refusal) return Failure(refusal);
  NSDictionary *result = [self move:downloadId record:record identity:identity approved:approved path:path folder:folder];
  os_unfair_lock_lock(&_lock);
  [_inFlight removeObject:downloadId];
  os_unfair_lock_unlock(&_lock);
  return result;
}

- (void)step:(NSString *)name staging:(int)staging {
  if (void (^hook)(NSString *, NSString *) = self.stepHook) hook(name, DirectoryPath(staging) ?: @"");
}

- (NSDictionary *)move:(NSString *)downloadId
                record:(NSDictionary *)record
              identity:(NSDictionary *)identity
              approved:(NSArray<NSArray<NSString *> *> *)approved
                  path:(NSString *)path
                folder:(NSString *)folder {
  NSArray<NSString *> *components = FolderComponents(folder);
  if (!components) return Failure(@"folderNotAllowed");
  NSUInteger rootLength = 0;
  for (NSArray<NSString *> *root in [approved arrayByAddingObject:@[ @"Downloads" ]])
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
  struct stat entry;
  if (fstatat(source.get(), sourceName.fileSystemRepresentation, &entry, AT_SYMLINK_NOFOLLOW) != 0) return Failure(@"missing");
  if (!S_ISREG(entry.st_mode)) return Failure(@"notAFile");
  if (entry.st_nlink != 1) return Failure(@"linked");
  struct stat sourceDir, destinationDir;
  if (fstat(source.get(), &sourceDir) != 0 || fstat(destination.get(), &destinationDir) != 0) return Failure(@"failed");
  if (sourceDir.st_dev == destinationDir.st_dev && sourceDir.st_ino == destinationDir.st_ino) return @{@"ok" : @YES, @"path" : path};
  if (sourceDir.st_dev != destinationDir.st_dev) return Failure(@"crossesVolumes");

  NSString *stagingName = MakeStaging(source.get());
  if (!stagingName) return Failure(@"failed");
  ScopedFd staging(OpenOwnStaging(source.get(), stagingName));
  if (!staging.valid()) return Failure(@"failed");
  NSMutableDictionary *journal = [@{@"source" : path, @"staging" : DirectoryPath(staging.get()) ?: @"", @"name" : sourceName,
                                    @"sha256" : identity[@"sha256"], @"size" : identity[@"size"], @"folder" : folder} mutableCopy];
  [self journal:downloadId entry:journal];
  const auto finish = [&] {
    unlinkat(source.get(), stagingName.fileSystemRepresentation, AT_REMOVEDIR);
    [self journal:downloadId entry:nil];
  };
  const auto keepStaged = [&](NSString *reason, NSString *name) -> NSDictionary * {
    NSString *stagedPath = [DirectoryPath(staging.get()) stringByAppendingPathComponent:name];
    if (stagedPath && [name isEqualToString:sourceName]) {
      os_unfair_lock_lock(&_lock);
      [self lockedRemember:downloadId from:path to:stagedPath];
      NSMutableDictionary *event = [_records[downloadId] mutableCopy];
      event[@"path"] = stagedPath;
      event[@"filename"] = stagedPath.lastPathComponent;
      _records[downloadId] = event;
      os_unfair_lock_unlock(&_lock);
    }
    [self journal:downloadId entry:nil];
    return StagedFailure(reason, stagedPath);
  };
  const auto giveBack = [&](NSString *reason) -> NSDictionary * {
    if (!Restore(staging.get(), sourceName, source.get(), sourceName)) return keepStaged(reason, sourceName);
    finish();
    return Failure(reason);
  };

  if (renameatx_np(source.get(), sourceName.fileSystemRepresentation, staging.get(), sourceName.fileSystemRepresentation, RENAME_EXCL) != 0) {
    const int error = errno;
    finish();
    return Failure(error == ENOENT ? @"missing" : @"failed");
  }
  [self step:@"claimed" staging:staging.get()];

  ScopedFd claimed(openat(staging.get(), sourceName.fileSystemRepresentation, O_RDONLY | O_NOFOLLOW | O_CLOEXEC));
  struct stat verified;
  if (!claimed.valid() || fstat(claimed.get(), &verified) != 0 || !S_ISREG(verified.st_mode)) return giveBack(@"changed");
  if (verified.st_nlink != 1) return giveBack(@"linked");
  if (verified.st_size != [identity[@"size"] longLongValue] || ![Sha256Of(claimed.get()) isEqualToString:identity[@"sha256"]])
    return giveBack(@"changed");
  [self step:@"verified" staging:staging.get()];

  NSString *safe = [ArdiaDownloadMover safeFileName:sourceName];
  NSString *placed = nil;
  for (int n = 0; n <= kMaxCollisions && !placed; n++) {
    NSString *candidate = n ? NameWithSuffix(safe, [NSString stringWithFormat:@" (%d)", n]) : safe;
    if (renameatx_np(staging.get(), sourceName.fileSystemRepresentation, destination.get(), candidate.fileSystemRepresentation,
                     RENAME_EXCL) == 0) {
      placed = candidate;
      break;
    }
    if (errno == EEXIST) continue;
    if (errno == ENOENT) return keepStaged(@"changed", @"");
    return giveBack(errno == EXDEV ? @"crossesVolumes" : @"failed");
  }
  if (!placed) return giveBack(@"tooManyCollisions");
  NSString *directory = DirectoryPath(destination.get()) ?: [_home stringByAppendingPathComponent:[components componentsJoinedByString:@"/"]];
  NSString *finalPath = [directory stringByAppendingPathComponent:placed];
  journal[@"placed"] = finalPath;
  [self journal:downloadId entry:journal];
  [self step:@"placed" staging:staging.get()];

  struct stat landed;
  const bool present = fstatat(destination.get(), placed.fileSystemRepresentation, &landed, AT_SYMLINK_NOFOLLOW) == 0;
  if (!present || landed.st_dev != verified.st_dev || landed.st_ino != verified.st_ino) {
    NSString *stray = [NSString stringWithFormat:@"not-%@", sourceName];
    NSDictionary *staged = keepStaged(@"changed", @"");
    if (!present || renameatx_np(destination.get(), placed.fileSystemRepresentation, staging.get(), stray.fileSystemRepresentation, RENAME_EXCL) == 0)
      return staged;
    NSMutableDictionary *withStray = [staged mutableCopy];
    withStray[@"strayPath"] = finalPath;
    return withStray;
  }
  if (landed.st_nlink != 1) {
    if (renameatx_np(destination.get(), placed.fileSystemRepresentation, staging.get(), sourceName.fileSystemRepresentation, RENAME_EXCL) == 0)
      return giveBack(@"linked");
    [self journal:downloadId entry:nil];
    return StagedFailure(@"linked", finalPath);
  }

  os_unfair_lock_lock(&_lock);
  [self lockedRemember:downloadId from:path to:finalPath];
  NSMutableDictionary *event = [record mutableCopy];
  event[@"path"] = finalPath;
  event[@"filename"] = placed;
  _records[downloadId] = event;
  os_unfair_lock_unlock(&_lock);
  finish();
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
