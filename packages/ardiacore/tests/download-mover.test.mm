#import "../ios/ArdiaDownloadMover.h"

#include <CommonCrypto/CommonDigest.h>
#include <cstdio>
#include <climits>
#include <cstdlib>
#include <sys/stat.h>
#include <sys/xattr.h>
#include <unistd.h>

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static NSString *gHome;
static NSString *gSource;
static int gNextId = 0;

static NSString *Make(NSString *relative, NSString *text) {
  NSString *path = [gHome stringByAppendingPathComponent:relative];
  [NSFileManager.defaultManager createDirectoryAtPath:path.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  [text writeToFile:path atomically:NO encoding:NSUTF8StringEncoding error:nil];
  return path;
}

static BOOL Exists(NSString *path) {
  struct stat info;
  return lstat(path.fileSystemRepresentation, &info) == 0;
}

static NSString *Text(NSString *path) {
  return [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
}

static NSString *Sha256(NSString *text) {
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString string];
  for (unsigned char byte : digest) [hex appendFormat:@"%02x", byte];
  return hex;
}

static NSMutableDictionary *FinishedEvent(NSString *path, NSString *downloaded) {
  return [@{@"id" : [NSString stringWithFormat:@"d%d", ++gNextId], @"path" : path, @"state" : @"finished", @"dangerous" : @NO,
            @"offTheRecord" : @NO, @"filename" : path.lastPathComponent, @"sha256" : Sha256(downloaded),
            @"received" : @([downloaded lengthOfBytesUsingEncoding:NSUTF8StringEncoding])} mutableCopy];
}

static NSArray<NSString *> *StagingDirs() {
  NSMutableArray *found = [NSMutableArray array];
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:gSource error:nil] ?: @[])
    if ([name hasPrefix:@".ardia-moving-"]) [found addObject:[gSource stringByAppendingPathComponent:name]];
  return found;
}

static NSString *Finished(ArdiaDownloadMover *mover, NSString *name, NSString *text, NSDictionary *extra = @{}) {
  NSString *path = Make([@"src" stringByAppendingPathComponent:name], text);
  NSMutableDictionary *event = FinishedEvent(path, text);
  [event addEntriesFromDictionary:extra];
  [mover noteDownloadEvent:event];
  return path;
}

static NSString *Reason(NSDictionary *result) {
  return [result[@"ok"] boolValue] ? @"ok" : result[@"reason"];
}

int main() {
  @autoreleasepool {
    char base[] = "/tmp/ardia-download-mover-XXXXXX";
    const char *made = mkdtemp(base);
    if (!made) return 1;
    char resolved[PATH_MAX];
    if (!realpath(made, resolved)) return 1;
    gHome = @(resolved);
    gSource = [gHome stringByAppendingPathComponent:@"src"];
    NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:[gHome stringByAppendingPathComponent:@"prefs"]];
    [NSFileManager.defaultManager createDirectoryAtPath:[gHome stringByAppendingPathComponent:@"Downloads"] withIntermediateDirectories:YES attributes:nil error:nil];
    ArdiaDownloadMover *mover = [[ArdiaDownloadMover alloc] initWithHome:gHome defaults:defaults];

    {
      NSString *stranger = Make(@"src/stranger.txt", @"not ours");
      CHECK([Reason([mover moveDownloadAt:stranger toFolder:@"~/Downloads"]) isEqual:@"notADownload"]);
      CHECK(Exists(stranger));
    }
    {
      NSString *path = Make(@"src/partial.bin", @"partial");
      [mover noteDownloadEvent:@{@"id" : @"partial", @"path" : path, @"state" : @"downloading"}];
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/Sorted"]) isEqual:@"notFinished"]);
      NSString *risky = Finished(mover, @"risky.dmg", @"x", @{@"dangerous" : @YES});
      CHECK([Reason([mover moveDownloadAt:risky toFolder:@"~/Downloads/Sorted"]) isEqual:@"dangerous"]);
      NSString *hidden = Finished(mover, @"private.txt", @"x", @{@"offTheRecord" : @YES});
      CHECK([Reason([mover moveDownloadAt:hidden toFolder:@"~/Downloads/Sorted"]) isEqual:@"private"]);
      CHECK(Exists(path) && Exists(risky) && Exists(hidden));
    }
    {
      NSString *path = Finished(mover, @"rules.txt", @"rules");
      for (NSString *folder in @[ @"/tmp", @"Downloads", @"~/", @"~", @"~/../Downloads", @"~/Downloads/../Documents", @"~/Downloads/./x",
                                  @"~/Downloads//x", @"~/Documents", @"~root/Downloads" ])
        CHECK([Reason([mover moveDownloadAt:path toFolder:folder]) isEqual:@"folderNotAllowed"]);
      CHECK(Exists(path));
    }
    {
      NSString *outside = [gHome stringByAppendingPathComponent:@"outside"];
      [NSFileManager.defaultManager createDirectoryAtPath:outside withIntermediateDirectories:YES attributes:nil error:nil];
      symlink(outside.fileSystemRepresentation, [gHome stringByAppendingPathComponent:@"Downloads/link"].fileSystemRepresentation);
      NSString *path = Finished(mover, @"linked.txt", @"linked");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/link/sub"]) isEqual:@"symlink"]);
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/link"]) isEqual:@"symlink"]);
      CHECK(Exists(path));
      CHECK(!Exists([outside stringByAppendingPathComponent:@"sub"]));
      CHECK(!Exists([outside stringByAppendingPathComponent:@"linked.txt"]));
      Make(@"Downloads/plain", @"a file");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/plain/sub"]) isEqual:@"notAFolder"]);
    }
    {
      NSString *path = Finished(mover, @"report.pdf", @"first");
      setxattr(path.fileSystemRepresentation, "com.apple.quarantine", "0083;00000000;Ardia;", 20, 0, 0);
      NSDictionary *result = [mover moveDownloadAt:path toFolder:@"~/Downloads/Sorted/2026"];
      CHECK([Reason(result) isEqual:@"ok"]);
      NSString *moved = [gHome stringByAppendingPathComponent:@"Downloads/Sorted/2026/report.pdf"];
      CHECK([result[@"path"] isEqual:moved]);
      CHECK([Text(moved) isEqual:@"first"]);
      CHECK(!Exists(path));
      CHECK(getxattr(moved.fileSystemRepresentation, "com.apple.quarantine", nullptr, 0, 0, 0) > 0);
      CHECK([result[@"event"][@"path"] isEqual:moved]);

      NSString *second = Finished(mover, @"report.pdf", @"second");
      NSDictionary *again = [mover moveDownloadAt:second toFolder:@"~/Downloads/Sorted/2026/"];
      CHECK([again[@"path"] isEqual:[gHome stringByAppendingPathComponent:@"Downloads/Sorted/2026/report (1).pdf"]]);
      CHECK([Text(moved) isEqual:@"first"]);
      CHECK([Text(again[@"path"]) isEqual:@"second"]);

      NSString *tarball = Finished(mover, @"site.tar.gz", @"one");
      [mover moveDownloadAt:tarball toFolder:@"~/Downloads/Sorted"];
      NSString *tarball2 = Finished(mover, @"site.tar.gz", @"two");
      CHECK([[[mover moveDownloadAt:tarball2 toFolder:@"~/Downloads/Sorted"][@"path"] lastPathComponent] isEqual:@"site (1).tar.gz"]);

      NSDictionary *stale = [mover noteDownloadEvent:@{@"id" : @"unknown", @"path" : @"/nowhere"}];
      CHECK([stale[@"path"] isEqual:@"/nowhere"]);
      NSString *movedId = [NSString stringWithFormat:@"d%d", gNextId - 2];
      NSDictionary *replayed = [mover noteDownloadEvent:@{@"id" : movedId, @"path" : second, @"state" : @"finished"}];
      CHECK([replayed[@"path"] isEqual:again[@"path"]]);
      ArdiaDownloadMover *relaunched = [[ArdiaDownloadMover alloc] initWithHome:gHome defaults:defaults];
      NSDictionary *afterRelaunch = [relaunched noteDownloadEvent:@{@"id" : movedId, @"path" : second, @"state" : @"finished"}];
      CHECK([afterRelaunch[@"path"] isEqual:again[@"path"]]);
    }
    {
      NSString *path = Finished(mover, @"swapped.txt", @"original");
      unlink(path.fileSystemRepresentation);
      Make(@"src/swapped.txt", @"impostor");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads"]) isEqual:@"changed"]);
      CHECK([Text(path) isEqual:@"impostor"]);
      NSString *gone = Finished(mover, @"gone.txt", @"x");
      unlink(gone.fileSystemRepresentation);
      CHECK([Reason([mover moveDownloadAt:gone toFolder:@"~/Downloads"]) isEqual:@"missing"]);
    }
    {
      NSString *path = Finished(mover, @"finance.csv", @"numbers");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Docs/Finance"]) isEqual:@"folderNotAllowed"]);
      [mover setApprovedFolders:@[ @"~/Docs/Finance", @"/etc", @"~/../escape", @"Docs" ]];
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Docs/Finance"]) isEqual:@"folderMissing"]);
      CHECK(!Exists([gHome stringByAppendingPathComponent:@"Docs"]));
      [NSFileManager.defaultManager createDirectoryAtPath:[gHome stringByAppendingPathComponent:@"Docs"] withIntermediateDirectories:YES attributes:nil error:nil];
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Docs/Finance/2026"]) isEqual:@"ok"]);
      CHECK([Text([gHome stringByAppendingPathComponent:@"Docs/Finance/2026/finance.csv"]) isEqual:@"numbers"]);
      NSString *other = Finished(mover, @"other.csv", @"x");
      CHECK([Reason([mover moveDownloadAt:other toFolder:@"~/Docs"]) isEqual:@"folderNotAllowed"]);
      CHECK([Reason([mover moveDownloadAt:other toFolder:@"~/etc"]) isEqual:@"folderNotAllowed"]);
      [mover setApprovedFolders:@[]];
      CHECK([Reason([mover moveDownloadAt:other toFolder:@"~/Docs/Finance"]) isEqual:@"folderNotAllowed"]);
    }
    {
      NSString *path = Make(@"src/no-hash.txt", @"webkit");
      NSMutableDictionary *event = FinishedEvent(path, @"webkit");
      [event removeObjectForKey:@"sha256"];
      [mover noteDownloadEvent:event];
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads"]) isEqual:@"noIdentity"]);
      CHECK(Exists(path));
    }
    {
      NSString *path = Make(@"src/invoice.pdf", @"an impostor another process put there");
      [mover noteDownloadEvent:FinishedEvent(path, @"the bytes the browser downloaded")];
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/Bills"]) isEqual:@"changed"]);
      CHECK([Text(path) isEqual:@"an impostor another process put there"]);
      CHECK(!Exists([gHome stringByAppendingPathComponent:@"Downloads/Bills/invoice.pdf"]));
      CHECK(StagingDirs().count == 0);
    }
    {
      NSString *path = Finished(mover, @"before-claim.txt", @"genuine");
      unlink(path.fileSystemRepresentation);
      Make(@"src/before-claim.txt", @"swapped in before the claim");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/Bills"]) isEqual:@"changed"]);
      CHECK([Text(path) isEqual:@"swapped in before the claim"]);
      CHECK(!Exists([gHome stringByAppendingPathComponent:@"Downloads/Bills/before-claim.txt"]));
      CHECK(StagingDirs().count == 0);
    }
    {
      NSString *path = Finished(mover, @"after-check.txt", @"genuine bytes");
      mover.stepHook = ^(NSString *step, NSString *staging) {
        if (![step isEqualToString:@"verified"]) return;
        NSString *staged = [staging stringByAppendingPathComponent:@"after-check.txt"];
        rename(staged.fileSystemRepresentation, [staging stringByAppendingPathComponent:@"hidden-away"].fileSystemRepresentation);
        [@"swapped in after the check" writeToFile:staged atomically:NO encoding:NSUTF8StringEncoding error:nil];
      };
      NSDictionary *result = [mover moveDownloadAt:path toFolder:@"~/Downloads/Bills"];
      mover.stepHook = nil;
      CHECK([Reason(result) isEqual:@"changed"]);
      CHECK(!Exists([gHome stringByAppendingPathComponent:@"Downloads/Bills/after-check.txt"]));
      NSString *staging = result[@"stagedPath"];
      CHECK(staging.length && Exists(staging));
      CHECK([Text([staging stringByAppendingPathComponent:@"hidden-away"]) isEqual:@"genuine bytes"]);
      CHECK([Text([staging stringByAppendingPathComponent:@"not-after-check.txt"]) isEqual:@"swapped in after the check"]);
      [NSFileManager.defaultManager removeItemAtPath:staging error:nil];
    }
    {
      NSString *path = Finished(mover, @"blocked.txt", @"genuine");
      mover.stepHook = ^(NSString *step, NSString *staging) {
        if (![step isEqualToString:@"claimed"]) return;
        NSFileHandle *staged = [NSFileHandle fileHandleForWritingAtPath:[staging stringByAppendingPathComponent:@"blocked.txt"]];
        [staged seekToEndOfFile];
        [staged writeData:[@" and tampered" dataUsingEncoding:NSUTF8StringEncoding]];
        [staged closeFile];
        Make(@"src/blocked.txt", @"something new at the old name");
      };
      NSDictionary *result = [mover moveDownloadAt:path toFolder:@"~/Downloads/Bills"];
      mover.stepHook = nil;
      CHECK([Reason(result) isEqual:@"changed"]);
      CHECK([Text(path) isEqual:@"something new at the old name"]);
      NSString *staged = result[@"stagedPath"];
      CHECK([staged.lastPathComponent isEqual:@"blocked.txt"]);
      CHECK([Text(staged) isEqual:@"genuine and tampered"]);
      CHECK(!Exists([gHome stringByAppendingPathComponent:@"Downloads/Bills/blocked.txt"]));
      struct stat info;
      CHECK(stat(staged.stringByDeletingLastPathComponent.fileSystemRepresentation, &info) == 0 && (info.st_mode & 0777) == 0700);
      [NSFileManager.defaultManager removeItemAtPath:staged.stringByDeletingLastPathComponent error:nil];
    }
    {
      NSString *path = Finished(mover, @"clean.txt", @"clean");
      CHECK([Reason([mover moveDownloadAt:path toFolder:@"~/Downloads/Bills"]) isEqual:@"ok"]);
      CHECK(StagingDirs().count == 0);
    }
    {
      CHECK([[ArdiaDownloadMover safeFileName:@".hidden"] isEqual:@"hidden"]);
      CHECK([[ArdiaDownloadMover safeFileName:@"a/b:c.txt"] isEqual:@"a_b_c.txt"]);
      CHECK([[ArdiaDownloadMover safeFileName:@"in‮gnp.exe"] isEqual:@"ingnp.exe"]);
      CHECK([[ArdiaDownloadMover safeFileName:@"tab\there\n.txt"] isEqual:@"tabhere.txt"]);
      CHECK([[ArdiaDownloadMover safeFileName:@" .. "] isEqual:@"download"]);
      NSString *longName = [[@"" stringByPaddingToLength:400 withString:@"é" startingAtIndex:0] stringByAppendingString:@".pdf"];
      NSString *cut = [ArdiaDownloadMover safeFileName:longName];
      CHECK([cut lengthOfBytesUsingEncoding:NSUTF8StringEncoding] <= 255);
      CHECK([cut hasSuffix:@".pdf"]);
    }
    [NSFileManager.defaultManager removeItemAtPath:gHome error:nil];
  }
  if (failures) std::printf("%d failure(s)\n", failures);
  else std::printf("download mover: all checks passed\n");
  return failures ? 1 : 0;
}
