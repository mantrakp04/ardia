#import "ArdiaFairPlay.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaRuntime.h"
#import "ArdiaTabRegistry.h"
#import "ArdiaWebViewInternal.h"

#include <climits>
#include <cmath>
#include <fcntl.h>

using namespace ardia_runtime;
using namespace ardia_web_view;

namespace {

NSString *const kSpotifyOrigin = @"https://open.spotify.com";
constexpr NSUInteger kMaxCertificate = 64 * 1024;
constexpr NSUInteger kMaxLicense = 64 * 1024;
constexpr NSUInteger kMaxPlaylistPart = 60 * 1024;
constexpr NSUInteger kMaxPlaylist = 2 * 1024 * 1024;
constexpr NSInteger kMaxParts = 40;
constexpr NSUInteger kMaxLine = 4 * 1024 * 1024;

NSString *HelperPath() {
  return [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Helpers/ArdiaFairPlay.app/Contents/MacOS/ArdiaFairPlay"];
}

bool WholeNumber(NSDictionary *d, NSString *key, NSInteger low, NSInteger high, NSInteger *out) {
  double value;
  if (!Finite(d, key, &value) || value != floor(value) || value < low || value > high) return false;
  *out = (NSInteger)value;
  return true;
}

bool RemoteOnlyPlaylist(NSString *playlist) {
  static NSRegularExpression *uris = [NSRegularExpression regularExpressionWithPattern:@"URI=\"([^\"]*)\"" options:0 error:nil];
  for (NSString *raw in [playlist componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    NSString *line = [raw stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if (!line.length) continue;
    if (![line hasPrefix:@"#"]) {
      if (![line.lowercaseString hasPrefix:@"https://"]) return false;
      continue;
    }
    for (NSTextCheckingResult *match in [uris matchesInString:line options:0 range:NSMakeRange(0, line.length)]) {
      NSString *uri = [line substringWithRange:[match rangeAtIndex:1]].lowercaseString;
      if (![uri hasPrefix:@"https://"] && ![uri hasPrefix:@"skd://"]) return false;
    }
  }
  return true;
}

NSString *HttpsURL(NSDictionary *d, NSString *key) {
  NSString *text = Text(d, key, 4096);
  return [[NSURL URLWithString:text ?: @""].scheme isEqualToString:@"https"] ? text : @"";
}

}

@implementation ArdiaFairPlay {
  NSTask *_task;
  NSFileHandle *_input;
  dispatch_queue_t _writes;
  NSMutableData *_output;
  __weak ArdiaCoreTab *_owner;
  NSString *_frame;
  NSInteger _generation;
  NSInteger _playedGeneration;
  NSInteger _failedGeneration;
  BOOL _playing;
  BOOL _pageMuted;
  NSInteger _partsGeneration;
  __weak ArdiaCoreTab *_partsTab;
  NSString *_partsFrame;
  NSMutableArray<NSString *> *_parts;
  NSString *_certificate;
}

+ (ArdiaFairPlay *)shared {
  static ArdiaFairPlay *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [ArdiaFairPlay new];
  });
  return shared;
}

+ (BOOL)available {
  return [NSFileManager.defaultManager isExecutableFileAtPath:HelperPath()];
}

+ (BOOL)servesOrigin:(NSString *)origin {
  return [origin isEqualToString:kSpotifyOrigin];
}

+ (void)tab:(ArdiaCoreTab *)tab frame:(NSString *)frameId message:(NSDictionary *)message {
  [self.shared tab:tab frame:frameId message:message];
}

+ (void)pageGoneFromTab:(ArdiaCoreTab *)tab {
  ArdiaFairPlay *shared = self.shared;
  if (tab && tab == shared->_owner) [shared stop];
}

+ (void)muteChangedInTab:(ArdiaCoreTab *)tab {
  ArdiaFairPlay *shared = self.shared;
  if (tab && tab == shared->_owner) [shared sendMuted];
}

+ (BOOL)playsInTab:(ArdiaCoreTab *)tab {
  ArdiaFairPlay *shared = self.shared;
  return tab && tab == shared->_owner && shared->_playing;
}

- (instancetype)init {
  if ((self = [super init])) _writes = dispatch_queue_create("ardia.fairplay.writes", DISPATCH_QUEUE_SERIAL);
  return self;
}

- (BOOL)owns:(ArdiaCoreTab *)tab frame:(NSString *)frameId {
  return tab == _owner && [frameId isEqualToString:_frame ?: @""];
}

- (void)tab:(ArdiaCoreTab *)tab frame:(NSString *)frameId message:(NSDictionary *)message {
  NSString *op = Text(message, @"op", 16);
  NSInteger generation = 0;
  if ([op isEqualToString:@"load"]) {
    [self loadPartIn:tab frame:frameId message:message];
  } else if (![self owns:tab frame:frameId]) {
    return;
  } else if ([op isEqualToString:@"license"]) {
    NSString *ckc = Text(message, @"ckc", kMaxLicense);
    if (WholeNumber(message, @"gen", 1, INT_MAX, &generation) && generation == _generation && ckc.length)
      [self send:@{@"op" : @"license", @"gen" : @(generation), @"ckc" : ckc}];
  } else if ([op isEqualToString:@"play"] || [op isEqualToString:@"pause"]) {
    [self send:@{@"op" : op}];
  } else if ([op isEqualToString:@"seek"]) {
    double time;
    NSInteger sequence = 0;
    if (Finite(message, @"time", &time) && time >= 0 && WholeNumber(message, @"seq", 0, INT_MAX, &sequence))
      [self send:@{@"op" : @"seek", @"time" : @(time), @"seq" : @(sequence)}];
  } else if ([op isEqualToString:@"volume"]) {
    double volume;
    if (Finite(message, @"volume", &volume)) [self send:@{@"op" : @"volume", @"volume" : @(MIN(MAX(volume, 0), 1))}];
  } else if ([op isEqualToString:@"muted"]) {
    _pageMuted = Flag(message, @"muted");
    [self sendMuted];
  } else if ([op isEqualToString:@"metadata"]) {
    [self send:@{
      @"op" : @"metadata",
      @"title" : Text(message, @"title", 1024) ?: @"",
      @"artist" : Text(message, @"artist", 1024) ?: @"",
      @"album" : Text(message, @"album", 1024) ?: @"",
      @"artwork" : HttpsURL(message, @"artwork"),
    }];
  } else if ([op isEqualToString:@"stop"]) {
    [self stop];
  }
}

- (void)loadPartIn:(ArdiaCoreTab *)tab frame:(NSString *)frameId message:(NSDictionary *)message {
  NSInteger generation, part, parts;
  NSString *text = Text(message, @"playlist", kMaxPlaylistPart);
  if (!WholeNumber(message, @"gen", 1, INT_MAX, &generation) || !WholeNumber(message, @"parts", 1, kMaxParts, &parts) ||
      !WholeNumber(message, @"part", 0, parts - 1, &part) || !text)
    return;
  if (part == 0) {
    _partsGeneration = generation;
    _partsTab = tab;
    _partsFrame = [frameId copy];
    _parts = [NSMutableArray array];
    _certificate = Text(message, @"cert", kMaxCertificate);
    if (!_certificate.length) {
      _parts = nil;
      return [self deliver:@{@"event" : @"failed", @"gen" : @(generation), @"step" : @"player"} to:tab frame:frameId];
    }
  }
  if (tab != _partsTab || ![frameId isEqualToString:_partsFrame ?: @""] || generation != _partsGeneration ||
      (NSInteger)_parts.count != part || !_certificate.length)
    return;
  [_parts addObject:text];
  if ((NSInteger)_parts.count < parts) return;
  NSString *playlist = [_parts componentsJoinedByString:@""];
  NSString *certificate = _certificate;
  _parts = nil;
  _certificate = nil;
  const BOOL playable = playlist.length <= kMaxPlaylist && [playlist hasPrefix:@"#EXTM3U"] && RemoteOnlyPlaylist(playlist);
  ArdiaCoreTab *previous = _owner;
  NSString *previousFrame = _frame;
  if (![self owns:tab frame:frameId]) {
    [self setPlaying:NO];
    if (previous) [self deliver:@{@"event" : @"stolen", @"gen" : @(_generation)} to:previous frame:previousFrame];
    _playedGeneration = 0;
    _failedGeneration = 0;
  }
  _owner = tab;
  _frame = [frameId copy];
  _generation = generation;
  _pageMuted = Flag(message, @"muted");
  double volume = 1;
  Finite(message, @"volume", &volume);
  if (!playable) return [self failed:@"playback" generation:generation];
  if (![self ensureHelper]) return [self failed:@"player" generation:generation];
  [self send:@{
    @"op" : @"load",
    @"gen" : @(generation),
    @"cert" : certificate,
    @"playlist" : playlist,
    @"volume" : @(MIN(MAX(volume, 0), 1)),
    @"muted" : @([self muted]),
  }];
  [self setPlaying:NO];
}

- (BOOL)muted {
  return _pageMuted || _owner.muted;
}

- (void)sendMuted {
  [self send:@{@"op" : @"muted", @"muted" : @([self muted])}];
}

- (BOOL)ensureHelper {
  if (_task.running) return YES;
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:HelperPath()];
  ArdiaLaunchConfig *config = ArdiaLaunchConfig.shared;
  NSMutableDictionary *environment = [config.environmentForChildProcesses mutableCopy];
  if (config.background) {
    environment[@"ARDIA_FAIRPLAY_SYSTEM_CONTROLS"] = @"0";
    if (![config instanceFlag:@"allowAudio"]) environment[@"ARDIA_FAIRPLAY_SILENT"] = @"1";
  }
  task.environment = environment;
  NSPipe *input = [NSPipe pipe], *output = [NSPipe pipe];
  task.standardInput = input;
  task.standardOutput = output;
  task.standardError = NSFileHandle.fileHandleWithNullDevice;
  __weak ArdiaFairPlay *weakSelf = self;
  __weak NSTask *weakTask = task;
  task.terminationHandler = ^(NSTask *) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf helperExited:weakTask];
    });
  };
  output.fileHandleForReading.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) {
      handle.readabilityHandler = nil;
      return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf received:data from:weakTask];
    });
  };
  NSError *error;
  if (![task launchAndReturnError:&error]) {
    output.fileHandleForReading.readabilityHandler = nil;
    return NO;
  }
  fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1);
  _task = task;
  _input = input.fileHandleForWriting;
  _output = [NSMutableData data];
  return YES;
}

- (void)send:(NSDictionary *)message {
  NSFileHandle *input = _input;
  if (!input) return;
  NSMutableData *line = [[NSJSONSerialization dataWithJSONObject:message options:0 error:nil] mutableCopy];
  if (!line) return;
  [line appendBytes:"\n" length:1];
  dispatch_async(_writes, ^{
    [input writeData:line error:nil];
  });
}

- (void)received:(NSData *)data from:(NSTask *)task {
  if (!task || task != _task || !_output) return;
  [_output appendData:data];
  if (_output.length > kMaxLine) return [self stop];
  for (;;) {
    const NSRange newline = [_output rangeOfData:[NSData dataWithBytes:"\n" length:1] options:0 range:NSMakeRange(0, _output.length)];
    if (newline.location == NSNotFound) break;
    NSData *line = [_output subdataWithRange:NSMakeRange(0, newline.location)];
    [_output replaceBytesInRange:NSMakeRange(0, newline.location + 1) withBytes:NULL length:0];
    id event = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
    if ([event isKindOfClass:NSDictionary.class]) [self helperEvent:event];
    if (task != _task) return;
  }
}

- (void)helperEvent:(NSDictionary *)event {
  ArdiaCoreTab *owner = _owner;
  if (!owner || owner.closed || owner.discarded) return [self stop];
  NSString *name = Text(event, @"event", 16);
  NSInteger generation = 0;
  const BOOL current = WholeNumber(event, @"gen", 1, INT_MAX, &generation) && generation == _generation;
  if ([name isEqualToString:@"position"] && current) {
    const BOOL playing = Flag(event, @"playing");
    [self setPlaying:playing];
    if (playing && _playedGeneration != generation) {
      _playedGeneration = generation;
      [self report:@{@"event" : @"played"}];
    }
  } else if ([name isEqualToString:@"failed"] && current) {
    [self setPlaying:NO];
    return [self failed:Text(event, @"step", 16) ?: @"playback" generation:generation];
  } else if ([name isEqualToString:@"ended"] && current) {
    [self setPlaying:NO];
  } else if (![name isEqualToString:@"remote"] && !current) {
    return;
  }
  [self deliver:event to:owner frame:_frame];
}

- (void)failed:(NSString *)step generation:(NSInteger)generation {
  if (_failedGeneration == generation) return;
  _failedGeneration = generation;
  NSString *known = [@[ @"license", @"playback", @"player" ] containsObject:step] ? step : @"playback";
  [self report:@{@"event" : @"failed", @"step" : known}];
  if (ArdiaCoreTab *owner = _owner) [self deliver:@{@"event" : @"failed", @"gen" : @(generation), @"step" : known} to:owner frame:_frame];
}

- (void)report:(NSDictionary *)payload {
  if (ArdiaCoreTab *owner = _owner) [[ArdiaTabRegistry viewForTab:owner] emit:@"fairPlay" payload:payload];
}

- (void)deliver:(NSDictionary *)event to:(ArdiaCoreTab *)tab frame:(NSString *)frameId {
  NSString *json = JSONText(event);
  if (frameId.length) [tab callFrame:frameId kind:@"fairPlay" json:json];
  else [tab callPage:@"fairPlay" json:json];
}

- (void)setPlaying:(BOOL)playing {
  if (playing == _playing) return;
  _playing = playing;
  if (ArdiaCoreTab *owner = _owner) [[ArdiaTabRegistry viewForTab:owner] emitMedia];
}

- (void)helperExited:(NSTask *)task {
  if (!task || task != _task) return;
  _task = nil;
  _input = nil;
  _output = nil;
  if (_owner && _generation) {
    [self setPlaying:NO];
    [self failed:@"player" generation:_generation];
  }
}

- (void)stop {
  NSTask *task = _task;
  NSFileHandle *input = _input;
  _task = nil;
  _input = nil;
  _output = nil;
  _parts = nil;
  _partsTab = nil;
  _partsFrame = nil;
  _certificate = nil;
  if (input)
    dispatch_async(_writes, ^{
      [input closeFile];
    });
  if (task)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      if (task.running) [task terminate];
    });
  [self setPlaying:NO];
  _owner = nil;
  _frame = nil;
  _generation = 0;
  _playedGeneration = 0;
  _failedGeneration = 0;
}

@end
